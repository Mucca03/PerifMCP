import { randomUUID } from 'node:crypto'
import { DEFAULT_LAYOUT, KeyboardServiceError, LAYERS } from '@perifmcp/core'
import type {
  ApplyResult,
  ConfigChange,
  ConfigDiffEntry,
  ConfigPlan,
  DeviceInfo,
  HexColor,
  KeyAssignment,
  KeyboardConfig,
  KeyboardLayout,
  KeyboardService,
  KeyboardStatus,
  KeysPlanInput,
  Layer,
  LightingPlanInput,
  LightingState,
  LightingZone,
  Macro,
  MacroPlanInput,
  PlanPreview,
  RestoreResult,
  RGBColor,
  Snapshot,
  SnapshotMeta,
  VerifyResult,
} from '@perifmcp/core'
import type { DeviceBackend } from '../backend/types.js'
import { MAX_REASON_LENGTH } from '../limits.js'
import {
  keysPlanInputSchema,
  lightingPlanInputSchema,
  macroPlanInputSchema,
  parseInput,
  snapshotInputSchema,
} from '../schemas.js'
import { affectedKeyIds, configToChanges } from './changes.js'
import { PlanStore } from './plan-store.js'
import { applyChanges, configRevision, diffConfig, hexToRgb, validateChange, zoneKeys } from './semantics-stub.js'
import { SnapshotStore } from './snapshot-store.js'
import { Mutex, errorMessage, jsonEqual, validationError } from './util.js'

export interface KeyboardServiceOptions {
  backend: DeviceBackend
  snapshots: SnapshotStore
  plans?: PlanStore
  /**
   * `PERIFMCP_ALLOW_WRITES=1` in the environment. Tests may pass it programmatically, against
   * `MockBackend` only. Writes also need a known model and a backend that supports them.
   */
  allowWrites?: boolean
}

const NONE: KeyAssignment = { kind: 'none' }

/** Broad zones first, so narrower zones win where they overlap. */
const ZONE_ORDER: readonly LightingZone[] = ['alphanumeric', 'top-row', 'modifiers', 'arrows', 'wasd']

const MAX_REPORTED_MISMATCHES = 10

function toRgb(hex: HexColor): RGBColor {
  const color = hexToRgb(hex)
  if (!color) throw new KeyboardServiceError('validation', 'Invalid color')
  return color
}

function deviceIdOf(info: DeviceInfo): string {
  return info.deviceId ?? `${info.vendorId.toString(16)}-${info.productId.toString(16)}`
}

function mismatchErrors(mismatches: ConfigDiffEntry[]): string[] {
  const errors = mismatches.slice(0, MAX_REPORTED_MISMATCHES).map((entry) => `Mismatch after write: ${entry.description}`)
  if (mismatches.length > MAX_REPORTED_MISMATCHES) {
    errors.push(`...and ${mismatches.length - MAX_REPORTED_MISMATCHES} more mismatches`)
  }
  return errors
}

export class KeyboardServiceImpl implements KeyboardService {
  private readonly backend: DeviceBackend
  private readonly snapshots: SnapshotStore
  private readonly plans: PlanStore
  private readonly allowWrites: boolean
  private readonly layout: KeyboardLayout = DEFAULT_LAYOUT
  /** Everything that can change the device or the snapshot folder runs one at a time. */
  private readonly lock = new Mutex()
  /** What the device should hold after the last apply or restore in this process. */
  private expected: { deviceId: string; config: KeyboardConfig } | undefined

  constructor(options: KeyboardServiceOptions) {
    this.backend = options.backend
    this.snapshots = options.snapshots
    this.plans = options.plans ?? new PlanStore()
    this.allowWrites = options.allowWrites ?? false
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async status(): Promise<KeyboardStatus> {
    let info: DeviceInfo | undefined
    let identifyError: string | undefined
    try {
      info = await this.backend.identify()
    } catch (error) {
      identifyError = errorMessage(error)
    }

    const reasons: string[] = []
    if (!this.allowWrites) reasons.push('Writes are disabled (PERIFMCP_ALLOW_WRITES=1 is not set)')
    if (info === undefined) {
      reasons.push(identifyError === undefined ? 'No keyboard is connected' : `Keyboard cannot be queried: ${identifyError}`)
    } else if (info.modelName === undefined) {
      reasons.push('The keyboard model is not recognised')
    }
    if (!this.backend.supportsWrites) reasons.push('The backend does not support writes yet')

    let configRevisionValue = 'unavailable'
    if (info !== undefined) {
      try {
        configRevisionValue = configRevision(await this.backend.readConfig())
      } catch {
        // The config may not be readable yet (protocol phase 2). Status must still work.
      }
    }

    const writeEnabled = reasons.length === 0
    const status: KeyboardStatus = {
      connection: info === undefined ? 'disconnected' : info.modelName === undefined ? 'unknown-model' : 'connected',
      transport: this.backend.transport,
      mode: this.allowWrites ? 'read-write' : 'read-only',
      writeEnabled,
      writeDisabledReasons: reasons,
      configRevision: configRevisionValue,
    }
    if (info !== undefined) {
      // The serial number is not needed by any client and is kept out of API and tool output.
      const { serialNumber: _serial, ...safeInfo } = info
      status.device = safeInfo
    }
    return status
  }

  async getLayout(): Promise<KeyboardLayout> {
    return this.layout
  }

  async getConfig(): Promise<KeyboardConfig> {
    await this.device()
    return this.read()
  }

  async getLayer(layer: Layer): Promise<Record<string, KeyAssignment>> {
    if (!(LAYERS as readonly string[]).includes(layer)) {
      throw new KeyboardServiceError('validation', 'Invalid input: layer: unknown layer')
    }
    return (await this.getConfig()).layers[layer]
  }

  async getMacros(): Promise<Macro[]> {
    return (await this.getConfig()).macros
  }

  async getLighting(): Promise<LightingState> {
    return (await this.getConfig()).lighting
  }

  // -------------------------------------------------------------------------
  // Planning (never touches the device beyond reading)
  // -------------------------------------------------------------------------

  async planKeys(rawInput: KeysPlanInput): Promise<ConfigPlan> {
    const input = parseInput(keysPlanInputSchema, rawInput)
    const { info, config } = await this.current()

    const warnings: string[] = []
    const changes: ConfigChange[] = []
    let unchanged = 0
    const entries = Object.entries(input.assignments).sort(
      ([a], [b]) => this.layout.keys.findIndex((key) => key.id === a) - this.layout.keys.findIndex((key) => key.id === b),
    )
    for (const [keyId, assignment] of entries) {
      if (assignment.kind === 'macro' && !config.macros.some((macro) => macro.id === assignment.macroId)) {
        throw new KeyboardServiceError('validation', `Invalid input: ${keyId}: macro "${assignment.macroId}" does not exist`)
      }
      const change: ConfigChange = { type: 'set-key', layer: input.layer, keyId, assignment }
      this.assertValid(change)
      if (jsonEqual(config.layers[input.layer][keyId] ?? NONE, assignment)) unchanged += 1
      else changes.push(change)
    }
    if (unchanged > 0) warnings.push(`${unchanged} assignment(s) already match the keyboard and were left out`)
    if (changes.length === 0) warnings.push('No changes: the keyboard already has these assignments')

    const keyList = changes.map((change) => (change.type === 'set-key' ? change.keyId : '')).join(', ')
    const summary =
      changes.length === 0
        ? `No key changes on layer ${input.layer}`
        : `Remap ${changes.length} key(s) on layer ${input.layer}: ${keyList}`
    return this.createPlan(info, config, changes, summary, warnings)
  }

  async planMacro(rawInput: MacroPlanInput): Promise<ConfigPlan> {
    const input = parseInput(macroPlanInputSchema, rawInput)
    const { info, config } = await this.current()

    const change: ConfigChange = { type: 'set-macro', macro: input.macro }
    this.assertValid(change)

    const existing = config.macros.find((macro) => macro.id === input.macro.id)
    const warnings: string[] = []
    const changes: ConfigChange[] = []
    if (existing !== undefined && jsonEqual(existing, input.macro)) {
      warnings.push('No changes: the keyboard already has this macro')
    } else {
      changes.push(change)
      if (existing !== undefined) warnings.push(`Replaces the existing macro "${existing.id}"`)
    }
    const summary = `${existing === undefined ? 'Add' : 'Replace'} macro "${input.macro.name}" (${input.macro.id}), ${input.macro.steps.length} step(s)`
    return this.createPlan(info, config, changes, summary, warnings)
  }

  async planLighting(rawInput: LightingPlanInput): Promise<ConfigPlan> {
    const input = parseInput(lightingPlanInputSchema, rawInput)
    if (Object.keys(input).length === 0) {
      throw new KeyboardServiceError('validation', 'Invalid input: at least one lighting field is required')
    }
    const { info, config } = await this.current()
    const warnings: string[] = []

    const colorsGiven = input.base !== undefined || input.zones !== undefined || input.perKey !== undefined
    const perKey: Record<string, RGBColor> = input.base === undefined ? { ...config.lighting.perKey } : {}
    if (input.base !== undefined) {
      const base = toRgb(input.base)
      for (const key of this.layout.keys) perKey[key.id] = { ...base }
    }

    // Precedence: base < zones (broad to narrow, see ZONE_ORDER) < perKey.
    const fromZone = new Map<string, { zone: LightingZone; color: HexColor }>()
    for (const zone of ZONE_ORDER) {
      const color = input.zones?.[zone]
      if (color === undefined) continue
      for (const keyId of zoneKeys(zone, this.layout)) {
        const earlier = fromZone.get(keyId)
        if (earlier !== undefined && earlier.color.toLowerCase() !== color.toLowerCase()) {
          warnings.push(`Zones "${earlier.zone}" and "${zone}" overlap on ${keyId}; "${zone}" wins`)
        }
        fromZone.set(keyId, { zone, color })
        perKey[keyId] = toRgb(color)
      }
    }
    for (const [keyId, color] of Object.entries(input.perKey ?? {})) perKey[keyId] = toRgb(color)

    const next: LightingState = { ...config.lighting, perKey }
    if (input.effect !== undefined) next.effect = input.effect
    else if (colorsGiven) next.effect = 'per-key'
    if (input.effect !== undefined || colorsGiven) next.enabled = next.effect !== 'off'
    if (input.color !== undefined) next.color = toRgb(input.color)
    if (input.speed !== undefined) next.speed = input.speed
    if (input.brightness !== undefined) next.brightness = input.brightness
    if (input.direction !== undefined) next.direction = input.direction

    if (next.effect === 'off' && Object.keys(input).some((key) => key !== 'effect')) {
      warnings.push('Lighting effect is off: these settings will not be visible until an effect is chosen')
    } else if (next.effect === 'per-key' && Object.keys(next.perKey).length === 0) {
      warnings.push('Effect is per-key but no key has a color: every key will stay dark')
    } else if (next.effect !== 'per-key' && colorsGiven && input.effect !== undefined) {
      warnings.push(`Effect "${next.effect}" does not use per-key colors; they are stored but not shown`)
    }

    const changes: ConfigChange[] = []
    if (jsonEqual(config.lighting, next)) {
      warnings.push('No changes: the keyboard already has this lighting')
    } else {
      const change: ConfigChange = { type: 'set-lighting', lighting: next }
      this.assertValid(change)
      changes.push(change)
    }

    const parts: string[] = []
    if (input.effect !== undefined) parts.push(`effect ${input.effect}`)
    if (colorsGiven) parts.push('key colors')
    if (input.color !== undefined) parts.push('main color')
    if (input.brightness !== undefined) parts.push(`brightness ${input.brightness}%`)
    if (input.speed !== undefined) parts.push(`speed ${input.speed}%`)
    if (input.direction !== undefined) parts.push(`direction ${input.direction}`)
    return this.createPlan(info, config, changes, `Update lighting: ${parts.join(', ')}`, warnings)
  }

  async listPlans(): Promise<ConfigPlan[]> {
    return this.plans.list()
  }

  async previewPlan(planId: string): Promise<PlanPreview> {
    const found = this.plans.lookup(planId)
    if (found === undefined) throw new KeyboardServiceError('plan-not-found', 'Plan not found or expired')
    const { config } = await this.current()
    const after = applyChanges(config, [...found.plan.changes])

    let plan = found.plan
    if (found.applied) {
      plan = { ...plan, warnings: [...plan.warnings, 'This plan was already applied'] }
    } else if (plan.baseRevision !== configRevision(config)) {
      plan = { ...plan, warnings: [...plan.warnings, 'This plan is stale: the keyboard changed since it was created'] }
    }
    return {
      plan,
      diff: diffConfig(config, after),
      affectedKeys: affectedKeyIds(config, plan.changes),
    }
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  applyPlan(planId: string, confirm: true): Promise<ApplyResult> {
    // `confirm` arrives from untrusted callers, so check the runtime value, not the type.
    if ((confirm as unknown) !== true) {
      return Promise.reject(new KeyboardServiceError('confirmation-required', 'confirm must be the boolean true'))
    }
    return this.lock.run(async () => {
      await this.requireWriteEnabled()
      const found = this.plans.lookup(planId)
      if (found === undefined) throw new KeyboardServiceError('plan-not-found', 'Plan not found or expired')
      if (found.applied) throw new KeyboardServiceError('plan-stale', 'This plan was already applied')
      const plan = found.plan

      const info = await this.device()
      const deviceId = deviceIdOf(info)
      if (plan.deviceId !== deviceId) {
        throw new KeyboardServiceError('plan-stale', 'This plan was created for a different keyboard')
      }
      const before = await this.read()
      if (configRevision(before) !== plan.baseRevision) {
        throw new KeyboardServiceError('plan-stale', 'The keyboard changed since this plan was created. Create a new plan.')
      }
      for (const change of plan.changes) this.assertValid(change)

      const snapshot = await this.saveSnapshot(deviceId, before, `Before applying plan ${plan.id}`, plan.id)
      const expected = applyChanges(before, [...plan.changes])
      const outcome = await this.writeAndVerify([...plan.changes], expected)
      this.plans.markApplied(plan.id)
      this.expected = { deviceId, config: outcome.applied ? expected : before }

      if (!outcome.applied) {
        outcome.errors.push(`The keyboard may be partly written. Restore snapshot ${snapshot.id} to go back.`)
      }
      return {
        planId: plan.id,
        applied: outcome.applied,
        verified: outcome.verified,
        errors: outcome.errors,
        snapshotId: snapshot.id,
      }
    })
  }

  async verify(): Promise<VerifyResult> {
    const info = await this.device()
    const config = await this.read()
    // Without an apply or restore in this process there is nothing to compare against.
    if (this.expected === undefined || this.expected.deviceId !== deviceIdOf(info)) {
      return { ok: true, mismatches: [] }
    }
    const mismatches = diffConfig(this.expected.config, config)
    return { ok: mismatches.length === 0, mismatches }
  }

  async snapshot(reason?: string): Promise<SnapshotMeta> {
    const parsed = parseInput(snapshotInputSchema, reason === undefined ? {} : { reason })
    return this.lock.run(async () => {
      const info = await this.device()
      const config = await this.read()
      return this.saveSnapshot(deviceIdOf(info), config, parsed.reason ?? 'Manual snapshot')
    })
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    const info = await this.device()
    try {
      return await this.snapshots.list(deviceIdOf(info))
    } catch (error) {
      throw new KeyboardServiceError('device-error', `Could not read snapshots: ${errorMessage(error)}`)
    }
  }

  restore(snapshotId: string, confirm: true): Promise<RestoreResult> {
    if ((confirm as unknown) !== true) {
      return Promise.reject(new KeyboardServiceError('confirmation-required', 'confirm must be the boolean true'))
    }
    return this.lock.run(async () => {
      await this.requireWriteEnabled()
      const info = await this.device()
      const deviceId = deviceIdOf(info)

      let target: Snapshot
      try {
        target = await this.snapshots.load(deviceId, snapshotId)
      } catch (error) {
        if (error instanceof KeyboardServiceError) throw error
        throw new KeyboardServiceError('device-error', `Could not read the snapshot: ${errorMessage(error)}`)
      }

      const current = await this.read()
      const changes = configToChanges(current, target.config)
      for (const change of changes) this.assertValid(change)

      const safety = await this.saveSnapshot(deviceId, current, `Before restoring snapshot ${target.id}`)
      const outcome = await this.writeAndVerify(changes, target.config)
      this.expected = { deviceId, config: outcome.applied ? target.config : current }

      if (!outcome.applied) {
        outcome.errors.push(`The keyboard may be partly written. Restore snapshot ${safety.id} to go back.`)
      }
      return {
        snapshotId: target.id,
        applied: outcome.applied,
        verified: outcome.verified,
        errors: outcome.errors,
        safetySnapshotId: safety.id,
      }
    })
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Writes the changes, reads back and compares. Never throws for a failed write or a mismatch. */
  private async writeAndVerify(
    changes: ConfigChange[],
    expected: KeyboardConfig,
  ): Promise<{ applied: boolean; verified: boolean; errors: string[] }> {
    const errors: string[] = []
    if (changes.length > 0) {
      try {
        await this.backend.writeChanges(changes)
      } catch (error) {
        if (error instanceof KeyboardServiceError && (error.code === 'write-disabled' || error.code === 'not-connected')) {
          throw error
        }
        errors.push(`Write failed: ${errorMessage(error)}`)
        return { applied: false, verified: false, errors }
      }
    }

    let after: KeyboardConfig
    try {
      after = await this.backend.readConfig()
    } catch (error) {
      errors.push(`Read-back failed: ${errorMessage(error)}`)
      return { applied: true, verified: false, errors }
    }
    const mismatches = diffConfig(expected, after)
    errors.push(...mismatchErrors(mismatches))
    return { applied: true, verified: mismatches.length === 0, errors }
  }

  private async requireWriteEnabled(): Promise<void> {
    const status = await this.status()
    if (!status.writeEnabled) {
      throw new KeyboardServiceError('write-disabled', `Cannot write: ${status.writeDisabledReasons.join('; ')}`, {
        reasons: status.writeDisabledReasons,
      })
    }
  }

  private async device(): Promise<DeviceInfo> {
    let info: DeviceInfo | undefined
    try {
      info = await this.backend.identify()
    } catch (error) {
      if (error instanceof KeyboardServiceError) throw error
      throw new KeyboardServiceError('device-error', `Keyboard cannot be queried: ${errorMessage(error)}`)
    }
    if (info === undefined) throw new KeyboardServiceError('not-connected', 'No keyboard is connected')
    return info
  }

  private async read(): Promise<KeyboardConfig> {
    try {
      return await this.backend.readConfig()
    } catch (error) {
      if (error instanceof KeyboardServiceError) throw error
      throw new KeyboardServiceError('device-error', `Could not read the keyboard configuration: ${errorMessage(error)}`)
    }
  }

  private async current(): Promise<{ info: DeviceInfo; config: KeyboardConfig }> {
    const info = await this.device()
    return { info, config: await this.read() }
  }

  private assertValid(change: ConfigChange): void {
    const errors = validateChange(change, this.layout)
    if (errors.length > 0) {
      throw validationError(errors.map((message) => ({ path: change.type, message })))
    }
  }

  private createPlan(
    info: DeviceInfo,
    config: KeyboardConfig,
    changes: ConfigChange[],
    summary: string,
    warnings: string[],
  ): ConfigPlan {
    return this.plans.add({
      id: randomUUID(),
      deviceId: deviceIdOf(info),
      baseRevision: configRevision(config),
      createdAt: new Date().toISOString(),
      summary,
      changes: structuredClone(changes),
      warnings,
      requiresConfirmation: true,
    })
  }

  private async saveSnapshot(
    deviceId: string,
    config: KeyboardConfig,
    reason: string,
    planId?: string,
  ): Promise<SnapshotMeta> {
    try {
      return await this.snapshots.save(deviceId, config, reason.slice(0, MAX_REASON_LENGTH), planId)
    } catch (error) {
      throw new KeyboardServiceError(
        'device-error',
        `Could not save the snapshot, so nothing was changed: ${errorMessage(error)}`,
      )
    }
  }
}
