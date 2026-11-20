/**
 * KeyboardService contract.
 *
 * Owner: master agent. Frozen before parallel work. Do not edit without
 * coordination: the daemon implements it, the web UI and the MCP tools consume it.
 *
 * Everything here is semantic. No matrix bytes, LED offsets or packets.
 */
import type {
  ApplyResult,
  ConfigPlan,
  DeviceInfo,
  KeyAssignment,
  KeyboardConfig,
  KeyboardLayout,
  Layer,
  LightingEffect,
  LightingState,
  Macro,
} from './types.js'

/** `#rrggbb`, lowercase or uppercase. Validated at the trust boundary. */
export type HexColor = `#${string}`

export const LIGHTING_ZONES = ['wasd', 'alphanumeric', 'top-row', 'arrows', 'modifiers'] as const
export type LightingZone = (typeof LIGHTING_ZONES)[number]

/** `read-only` is the default. `read-write` must be enabled explicitly by the master agent. */
export type AccessMode = 'read-only' | 'read-write'

export type ConnectionState = 'disconnected' | 'connected' | 'unknown-model'

/**
 * Where the configuration returned by `getConfig()` comes from.
 * - `device`: read from the keyboard.
 * - `last-written`: the last configuration this app wrote. These keyboards have no read-back command, so the
 *   keyboard itself may differ if it was changed by other means (another tool, a factory reset).
 * - `assumed-default`: nothing was ever written, so the factory state is assumed.
 */
export type ConfigSource = 'device' | 'last-written' | 'assumed-default'

export interface KeyboardStatus {
  connection: ConnectionState
  transport: 'hidraw' | 'mock'
  mode: AccessMode
  /** True only when mode is `read-write` and the model is known. */
  writeEnabled: boolean
  /** Human-readable reasons why writes are disabled. Empty when writeEnabled. */
  writeDisabledReasons: string[]
  device?: DeviceInfo
  activeLayer?: Layer
  /** Hash of the current KeyboardConfig. Plans are bound to it. */
  configRevision: string
  configSource: ConfigSource
}

// ---------------------------------------------------------------------------
// Plan inputs (what an agent or the UI asks for)
// ---------------------------------------------------------------------------

export interface KeysPlanInput {
  layer: Layer
  /** keyId -> assignment. Key ids come from the layout (`escape`, `space`, ...). */
  assignments: Record<string, KeyAssignment>
}

export interface MacroPlanInput {
  macro: Macro
}

export interface LightingPlanInput {
  zones?: Partial<Record<LightingZone, HexColor>>
  perKey?: Record<string, HexColor>
  /** Color for every key not covered by `zones` or `perKey`. */
  base?: HexColor
  effect?: LightingEffect
  /** Main color for effects that use a single color. */
  color?: HexColor
  /** Percent, 0-100. The protocol layer maps it to device units. */
  speed?: number
  /** Percent, 0-100. */
  brightness?: number
  direction?: number
}

// ---------------------------------------------------------------------------
// Preview, diff, verify, snapshots
// ---------------------------------------------------------------------------

export interface ConfigDiffEntry {
  /** Stable dotted path, e.g. `layers.base.capslock` or `lighting.effect`. */
  path: string
  before: unknown
  after: unknown
  /** Short sentence for humans: "capslock: key capslock -> key escape". */
  description: string
}

export interface PlanPreview {
  plan: ConfigPlan
  diff: ConfigDiffEntry[]
  /** Key ids touched by the plan, for highlighting in the UI. */
  affectedKeys: string[]
}

export interface VerifyResult {
  ok: boolean
  /** Differences between the expected config and what the device reports. Empty when ok. */
  mismatches: ConfigDiffEntry[]
}

export interface SnapshotMeta {
  id: string
  deviceId: string
  createdAt: string
  reason: string
  /** Plan that triggered this snapshot, if any. */
  planId?: string
}

export interface Snapshot extends SnapshotMeta {
  config: KeyboardConfig
}

export interface RestoreResult {
  snapshotId: string
  applied: boolean
  verified: boolean
  errors: string[]
  /** Snapshot of the state taken just before restoring, so the restore is reversible. */
  safetySnapshotId?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const SERVICE_ERROR_CODES = [
  'not-connected',
  'unknown-model',
  'write-disabled',
  'validation',
  'plan-not-found',
  'plan-stale',
  'confirmation-required',
  'snapshot-not-found',
  'verify-failed',
  'device-error',
] as const

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number]

export class KeyboardServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'KeyboardServiceError'
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Single owner of the device connection. The HTTP API and the MCP tools are thin
 * adapters over this interface and must not add behavior of their own.
 *
 * Rules:
 * - Read methods work in every mode.
 * - `plan*` methods never touch the device. They validate, diff and store the plan in memory.
 * - A plan is immutable. `applyPlan` fails with `plan-stale` if `plan.baseRevision`
 *   no longer matches `status().configRevision`.
 * - `applyPlan` and `restore` require `confirm: true`, fail with `write-disabled` unless
 *   `status().writeEnabled`, and always take a snapshot first.
 * - Write order: snapshot -> write changed records only -> read back -> compare.
 */
export interface KeyboardService {
  status(): Promise<KeyboardStatus>
  getLayout(): Promise<KeyboardLayout>
  getConfig(): Promise<KeyboardConfig>
  getLayer(layer: Layer): Promise<Record<string, KeyAssignment>>
  getMacros(): Promise<Macro[]>
  getLighting(): Promise<LightingState>

  planKeys(input: KeysPlanInput): Promise<ConfigPlan>
  planMacro(input: MacroPlanInput): Promise<ConfigPlan>
  planLighting(input: LightingPlanInput): Promise<ConfigPlan>
  /** Pending (not yet applied) plans, newest first. Lets the UI show plans created by an agent. */
  listPlans(): Promise<ConfigPlan[]>
  previewPlan(planId: string): Promise<PlanPreview>
  applyPlan(planId: string, confirm: true): Promise<ApplyResult>

  verify(): Promise<VerifyResult>

  snapshot(reason?: string): Promise<SnapshotMeta>
  listSnapshots(): Promise<SnapshotMeta[]>
  restore(snapshotId: string, confirm: true): Promise<RestoreResult>
}
