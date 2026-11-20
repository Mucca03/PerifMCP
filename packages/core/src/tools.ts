/**
 * MCP tool contract.
 *
 * Owner: master agent. Frozen before parallel work.
 *
 * Naming: `keyboard_<verb>` with underscores. Dots are not portable across MCP clients.
 * Each tool is a thin adapter over one `KeyboardService` method. The daemon exposes the
 * tools over MCP Streamable HTTP in the same process that owns the device, so the UI and
 * the agent share one connection. There is no separate stdio server that opens the device.
 *
 * There is no raw HID tool and there must never be one.
 */
import type { ApplyResult, ConfigPlan, KeyAssignment, KeyboardConfig, KeyboardLayout, Layer, LightingState, Macro } from './types.js'
import type {
  KeyboardStatus,
  KeysPlanInput,
  LightingPlanInput,
  MacroPlanInput,
  PlanPreview,
  RestoreResult,
  SnapshotMeta,
  VerifyResult,
} from './service.js'

export const READ_ONLY_TOOLS = [
  'keyboard_status',
  'keyboard_get_layout',
  'keyboard_get_config',
  'keyboard_get_macros',
  'keyboard_get_lighting',
  'keyboard_preview_plan',
  'keyboard_list_snapshots',
  'keyboard_verify',
] as const

/** Tools that create in-memory plans. They never touch the device. */
export const PLANNING_TOOLS = ['keyboard_plan_keys', 'keyboard_plan_macro', 'keyboard_plan_lighting'] as const

/** Tools that write to the device. Require `confirm: true` and `status().writeEnabled`. */
export const WRITE_TOOLS = ['keyboard_apply_plan', 'keyboard_snapshot', 'keyboard_restore'] as const

export type ToolName =
  | (typeof READ_ONLY_TOOLS)[number]
  | (typeof PLANNING_TOOLS)[number]
  | (typeof WRITE_TOOLS)[number]

export interface ToolContract {
  keyboard_status: { input: Record<string, never>; output: KeyboardStatus }
  keyboard_get_layout: { input: Record<string, never>; output: KeyboardLayout }
  keyboard_get_config: {
    input: { layer?: Layer }
    output: KeyboardConfig | { layer: Layer; assignments: Record<string, KeyAssignment> }
  }
  keyboard_get_macros: { input: Record<string, never>; output: Macro[] }
  keyboard_get_lighting: { input: Record<string, never>; output: LightingState }

  keyboard_plan_keys: { input: KeysPlanInput; output: ConfigPlan }
  keyboard_plan_macro: { input: MacroPlanInput; output: ConfigPlan }
  keyboard_plan_lighting: { input: LightingPlanInput; output: ConfigPlan }
  keyboard_preview_plan: { input: { planId: string }; output: PlanPreview }
  keyboard_apply_plan: { input: { planId: string; confirm: true }; output: ApplyResult }

  keyboard_verify: { input: Record<string, never>; output: VerifyResult }

  /** Taking a snapshot only reads the device, but it persists data, so it is listed as a write tool. */
  keyboard_snapshot: { input: { reason?: string }; output: SnapshotMeta }
  keyboard_list_snapshots: { input: Record<string, never>; output: SnapshotMeta[] }
  keyboard_restore: { input: { snapshotId: string; confirm: true }; output: RestoreResult }
}

// Compile-time check: every tool name has a contract and vice versa.
type _Exhaustive = ToolName extends keyof ToolContract ? (keyof ToolContract extends ToolName ? true : never) : never
export const _toolContractIsExhaustive: _Exhaustive = true
