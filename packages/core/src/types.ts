export const LAYERS = ['base', 'fn1', 'fn2', 'fn3'] as const

export type Layer = (typeof LAYERS)[number]

export type Modifier = 'ctrl' | 'shift' | 'alt' | 'gui'

export type KeyAssignment =
  | { kind: 'key'; code: string; modifiers?: Modifier[] }
  | { kind: 'macro'; macroId: string }
  | { kind: 'layer'; layer: Layer }
  | { kind: 'none' }

export type MacroStep =
  | { type: 'key'; code: string; modifiers?: Modifier[] }
  | { type: 'delay'; ms: number }

export interface Macro {
  id: string
  name: string
  steps: MacroStep[]
  repeat?: number
}

export interface RGBColor {
  r: number
  g: number
  b: number
}

export const LIGHTING_EFFECTS = [
  'off',
  'solid',
  'breathing',
  'rainbow',
  'wave',
  'reactive',
  'per-key',
] as const

export type LightingEffect = (typeof LIGHTING_EFFECTS)[number]

export interface LightingState {
  enabled: boolean
  effect: LightingEffect
  color: RGBColor
  brightness: number
  speed: number
  direction: number
  perKey: Record<string, RGBColor>
}

export interface KeyboardSettings {
  nkro: boolean
  osMode: 'win' | 'mac'
  sleepMinutes?: number
}

export interface KeyboardConfig {
  layers: Record<Layer, Record<string, KeyAssignment>>
  macros: Macro[]
  lighting: LightingState
  settings: KeyboardSettings
}

export interface MatrixPosition {
  row: number
  column: number
}

export interface KeyDefinition {
  id: string
  label: string
  legend?: string
  /** Horizontal position in keyboard units. */
  x: number
  /** Vertical position in keyboard units. */
  y: number
  /** Width in keyboard units. */
  width?: number
  row: number
  matrix?: MatrixPosition
  zone: 'main' | 'modifier' | 'arrow' | 'navigation'
}

export interface KeyboardLayout {
  id: string
  name: string
  standard: 'ANSI'
  keyCount: number
  width: number
  rows: number
  keys: KeyDefinition[]
}

export interface DeviceSummary {
  id: string
  vendorId: number
  productId: number
  manufacturer?: string | undefined
  product?: string | undefined
  serialNumber?: string | undefined
  usagePage?: number | undefined
  path?: string | undefined
}

export interface MatrixInfo {
  row: number
  column: number
}

export interface DeviceInfo {
  vendorId: number
  productId: number
  manufacturer?: string | undefined
  product?: string | undefined
  serialNumber?: string | undefined
  transport: 'hidraw' | 'mock'
  modelId?: number | undefined
  modelName?: string | undefined
  firmwareId?: number | undefined
  firmwareVersion?: number | undefined
  deviceId?: string | undefined
  matrix?: MatrixInfo | undefined
}

export type ConfigChange =
  | { type: 'set-key'; layer: Layer; keyId: string; assignment: KeyAssignment }
  | { type: 'set-macro'; macro: Macro }
  | { type: 'remove-macro'; macroId: string }
  | { type: 'set-lighting'; lighting: LightingState }
  | { type: 'set-settings'; settings: KeyboardSettings }

export interface ConfigPlan {
  id: string
  deviceId: string
  /** `KeyboardStatus.configRevision` when the plan was created. Apply fails if it changed. */
  baseRevision: string
  createdAt: string
  summary: string
  changes: ConfigChange[]
  warnings: string[]
  requiresConfirmation: boolean
}

export interface ApplyResult {
  planId: string
  applied: boolean
  verified: boolean
  errors: string[]
  snapshotId?: string
}
