import {
  DEFAULT_LAYOUT,
  createDefaultConfig,
  type AccessMode,
  type ApplyResult,
  type ConfigChange,
  type ConfigDiffEntry,
  type ConfigPlan,
  type KeyboardConfig,
  type KeyboardLayout,
  type KeyboardStatus,
  type LightingState,
  type Macro,
  type PlanPreview,
  type RestoreResult,
  type Snapshot,
  type SnapshotMeta,
  type VerifyResult,
} from '@perifmcp/core'
import { ApiError, type ApiClient } from './client'
import {
  applyChanges,
  configRevision,
  diffConfig,
  hexToRgb,
  lightingInputToState,
  validateChange,
} from './semantics'

const DEVICE_ID = 'mock-gim-k64'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface MockOptions {
  mode?: AccessMode
  /** Seed one plan that looks like it was created by an agent over MCP. Default true. */
  seedAgentPlan?: boolean
}

/**
 * In-memory implementation of the same rules as the real `KeyboardService`:
 * plans are immutable, apply needs `confirm: true`, `writeEnabled`, a matching revision, and takes a snapshot first.
 */
export class MockApiClient implements ApiClient {
  readonly kind = 'mock' as const

  private readonly layoutData: KeyboardLayout = DEFAULT_LAYOUT
  private state: KeyboardConfig
  private mode: AccessMode
  private plans: ConfigPlan[] = []
  private snapshots: Snapshot[] = []
  private counter = 0
  private lastMismatches: ConfigDiffEntry[] = []
  private verifyFailureQueued = false

  constructor(options: MockOptions = {}) {
    this.mode = options.mode ?? 'read-write'
    this.state = seedConfig()
    if (options.seedAgentPlan ?? true) this.seedAgentPlan()
  }

  // --- mock-only controls (not part of ApiClient) ------------------------------------------

  getMode(): AccessMode {
    return this.mode
  }

  setMode(mode: AccessMode): void {
    this.mode = mode
  }

  /** The next apply or restore reports `verified: false` and `verify()` returns a mismatch. */
  queueVerifyFailure(): void {
    this.verifyFailureQueued = true
  }

  // --- reads -------------------------------------------------------------------------------

  status: ApiClient['status'] = async () => this.currentStatus()
  layout: ApiClient['layout'] = async () => clone(this.layoutData)
  config: ApiClient['config'] = async () => clone(this.state)
  macros: ApiClient['macros'] = async () => clone(this.state.macros)
  lighting: ApiClient['lighting'] = async () => clone(this.state.lighting)

  // --- plans -------------------------------------------------------------------------------

  planKeys: ApiClient['planKeys'] = async (input) => {
    const changes: ConfigChange[] = Object.entries(input.assignments).map(([keyId, assignment]) => ({
      type: 'set-key',
      layer: input.layer,
      keyId,
      assignment,
    }))
    if (changes.length === 0) throw new ApiError('validation', 'No assignments given.', 400)
    for (const change of changes) {
      if (change.type === 'set-key' && change.assignment.kind === 'macro') {
        const macroId = change.assignment.macroId
        if (!this.state.macros.some((m) => m.id === macroId)) {
          throw new ApiError('validation', `Macro "${macroId}" does not exist.`, 400)
        }
      }
    }
    const keys = changes.map((c) => (c.type === 'set-key' ? c.keyId : '')).join(', ')
    return this.createPlan(`Set ${keys} on ${input.layer}`, changes)
  }

  planMacro: ApiClient['planMacro'] = async (input) => {
    const known = this.state.macros.some((m) => m.id === input.macro.id)
    return this.createPlan(`${known ? 'Update' : 'Add'} macro "${input.macro.name}"`, [
      { type: 'set-macro', macro: clone(input.macro) },
    ])
  }

  planLighting: ApiClient['planLighting'] = async (input) => {
    for (const hex of [input.base, input.color, ...Object.values(input.zones ?? {}), ...Object.values(input.perKey ?? {})]) {
      if (hex !== undefined && !hexToRgb(hex)) throw new ApiError('validation', `"${hex}" is not a #rrggbb color.`, 400)
    }
    const lighting = lightingInputToState(this.state.lighting, input, this.layoutData)
    return this.createPlan(`Lighting: ${lighting.effect}`, [{ type: 'set-lighting', lighting }])
  }

  listPlans: ApiClient['listPlans'] = async () => clone([...this.plans].reverse())

  previewPlan: ApiClient['previewPlan'] = async (id) => {
    const plan = this.requirePlan(id)
    const after = applyChanges(this.state, plan.changes)
    const diff = diffConfig(this.state, after)
    return { plan: clone(plan), diff, affectedKeys: affectedKeys(plan.changes, diff) } satisfies PlanPreview
  }

  applyPlan: ApiClient['applyPlan'] = async (id, body) => {
    if ((body as { confirm?: unknown } | undefined)?.confirm !== true) {
      throw new ApiError('confirmation-required', 'Send confirm: true.', 400)
    }
    this.requireWritable()
    const plan = this.requirePlan(id)
    if (plan.baseRevision !== this.revision()) {
      throw new ApiError('plan-stale', 'The configuration changed after this plan was created.', 409)
    }
    const snapshot = this.takeSnapshot(`before plan ${plan.id}`, plan.id)
    const expected = applyChanges(this.state, plan.changes)
    this.state = expected
    this.plans = this.plans.filter((p) => p.id !== plan.id)
    const verified = this.finishWrite(expected)
    return {
      planId: plan.id,
      applied: true,
      verified,
      errors: verified ? [] : ['Read-back differs from the written configuration.'],
      snapshotId: snapshot.id,
    } satisfies ApplyResult
  }

  // --- verify ------------------------------------------------------------------------------

  verify: ApiClient['verify'] = async () => ({ ok: this.lastMismatches.length === 0, mismatches: clone(this.lastMismatches) }) satisfies VerifyResult

  // --- snapshots ---------------------------------------------------------------------------

  listSnapshots: ApiClient['listSnapshots'] = async () => this.snapshots.map(toMeta).reverse()

  createSnapshot: ApiClient['createSnapshot'] = async (body) => {
    this.requireWritable()
    return toMeta(this.takeSnapshot(body.reason?.trim() || 'manual snapshot'))
  }

  restoreSnapshot: ApiClient['restoreSnapshot'] = async (id, body) => {
    if ((body as { confirm?: unknown } | undefined)?.confirm !== true) {
      throw new ApiError('confirmation-required', 'Send confirm: true.', 400)
    }
    this.requireWritable()
    const snapshot = this.snapshots.find((s) => s.id === id)
    if (!snapshot) throw new ApiError('snapshot-not-found', `No snapshot ${id}.`, 404)
    const safety = this.takeSnapshot(`before restore ${id}`)
    this.state = clone(snapshot.config)
    const verified = this.finishWrite(this.state)
    return {
      snapshotId: id,
      applied: true,
      verified,
      errors: verified ? [] : ['Read-back differs from the restored configuration.'],
      safetySnapshotId: safety.id,
    } satisfies RestoreResult
  }

  // --- internals ---------------------------------------------------------------------------

  private revision(): string {
    return configRevision(this.state)
  }

  private currentStatus(): KeyboardStatus {
    const writeEnabled = this.mode === 'read-write'
    return {
      connection: 'connected',
      transport: 'mock',
      mode: this.mode,
      writeEnabled,
      writeDisabledReasons: writeEnabled ? [] : ['Access mode is read-only. The master agent enables writes explicitly.'],
      device: {
        vendorId: 0x1ea7,
        productId: 0x0907,
        manufacturer: 'mock',
        product: 'GIM K64 RGB (mock)',
        transport: 'mock',
        modelName: 'GIM K64 RGB',
      },
      activeLayer: 'base',
      configRevision: this.revision(),
    }
  }

  private requireWritable(): void {
    const status = this.currentStatus()
    if (!status.writeEnabled) throw new ApiError('write-disabled', status.writeDisabledReasons.join(' '), 403)
  }

  private requirePlan(id: string): ConfigPlan {
    const plan = this.plans.find((p) => p.id === id)
    if (!plan) throw new ApiError('plan-not-found', `No pending plan ${id}.`, 404)
    return plan
  }

  private createPlan(summary: string, changes: ConfigChange[]): ConfigPlan {
    const errors = changes.flatMap((c) => validateChange(c, this.layoutData))
    if (errors.length > 0) throw new ApiError('validation', errors.join(' '), 400, errors)
    const after = applyChanges(this.state, changes)
    const warnings: string[] = []
    if (diffConfig(this.state, after).length === 0) warnings.push('This plan changes nothing.')
    const plan: ConfigPlan = {
      id: `plan-${++this.counter}`,
      deviceId: DEVICE_ID,
      baseRevision: this.revision(),
      createdAt: new Date().toISOString(),
      summary,
      changes: clone(changes),
      warnings,
      requiresConfirmation: true,
    }
    this.plans.push(plan)
    return clone(plan)
  }

  private takeSnapshot(reason: string, planId?: string): Snapshot {
    const snapshot: Snapshot = {
      id: `snap-${++this.counter}`,
      deviceId: DEVICE_ID,
      createdAt: new Date().toISOString(),
      reason,
      config: clone(this.state),
      ...(planId === undefined ? {} : { planId }),
    }
    this.snapshots.push(snapshot)
    return snapshot
  }

  /** Simulates the read-back. Returns false when a failure was queued with `queueVerifyFailure`. */
  private finishWrite(expected: KeyboardConfig): boolean {
    if (!this.verifyFailureQueued) {
      this.lastMismatches = []
      return true
    }
    this.verifyFailureQueued = false
    const device = clone(expected)
    device.lighting.brightness = Math.max(0, expected.lighting.brightness - 10)
    this.lastMismatches = diffConfig(expected, device)
    return false
  }

  private seedAgentPlan(): void {
    const change: ConfigChange = { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'escape' } }
    this.createPlan('Agent: map Caps Lock to Escape', [change])
  }
}

function toMeta(snapshot: Snapshot): SnapshotMeta {
  const { config: _config, ...meta } = snapshot
  void _config
  return meta
}

function affectedKeys(changes: ConfigChange[], diff: ConfigDiffEntry[]): string[] {
  const ids = new Set<string>()
  for (const change of changes) {
    if (change.type === 'set-key') ids.add(change.keyId)
  }
  for (const entry of diff) {
    const match = /^(?:layers\.[a-z0-9]+|lighting\.perKey)\.(.+)$/.exec(entry.path)
    if (match?.[1]) ids.add(match[1])
  }
  return [...ids]
}

function seedConfig(): KeyboardConfig {
  const config = createDefaultConfig()
  const lighting: LightingState = {
    enabled: true,
    effect: 'per-key',
    color: { r: 134, g: 239, b: 172 },
    // Percent. The real default config moves to percent in the protocol agent's phase 1.
    brightness: 70,
    speed: 50,
    direction: 0,
    perKey: {},
  }
  for (const id of ['w', 'a', 's', 'd']) lighting.perKey[id] = hexToRgb('#c084fc') ?? { r: 192, g: 132, b: 252 }
  lighting.perKey.escape = hexToRgb('#f9a8d4') ?? { r: 249, g: 168, b: 212 }
  config.lighting = lighting
  const macro: Macro = {
    id: 'macro-hello',
    name: 'hello',
    repeat: 1,
    steps: [
      { type: 'key', code: 'h' },
      { type: 'delay', ms: 30 },
      { type: 'key', code: 'i' },
    ],
  }
  config.macros = [macro]
  return config
}
