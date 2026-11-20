/**
 * TEMPORARY stand-ins for `packages/core/src/semantics.ts` (protocol sub-agent, phase 1).
 * Same signatures as `docs/agents/protocol.md`. Delete the duplicated functions once the real ones are merged.
 * `lightingInputToState` and `describeAssignment` are not in that list: they stay UI/mock helpers.
 */
import {
  DEFAULT_LAYOUT,
  LIGHTING_EFFECTS,
  LAYERS,
  type ConfigChange,
  type ConfigDiffEntry,
  type HexColor,
  type KeyAssignment,
  type KeyboardConfig,
  type KeyboardLayout,
  type LightingPlanInput,
  type LightingState,
  type LightingZone,
  type RGBColor,
} from '@perifmcp/core'
import { isKeyCode } from './keys'

// --- canonical JSON and revision -------------------------------------------------------------

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

/** FNV-1a over canonical JSON. Stable, sync, no node:crypto. */
export function configRevision(config: KeyboardConfig): string {
  const text = canonical(config)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// --- colors ----------------------------------------------------------------------------------

export function hexToRgb(hex: string): RGBColor | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return undefined
  return { r: parseInt(match[1] ?? '', 16), g: parseInt(match[2] ?? '', 16), b: parseInt(match[3] ?? '', 16) }
}

export function rgbToHex(color: RGBColor): HexColor {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

// --- zones -----------------------------------------------------------------------------------

export function zoneKeys(zone: LightingZone, layout: KeyboardLayout = DEFAULT_LAYOUT): string[] {
  const ids = layout.keys
  switch (zone) {
    case 'wasd':
      return ids.filter((k) => ['w', 'a', 's', 'd'].includes(k.id)).map((k) => k.id)
    case 'alphanumeric':
      return ids.filter((k) => /^([a-z]|digit[0-9])$/.test(k.id)).map((k) => k.id)
    case 'top-row':
      return ids.filter((k) => k.row === 0).map((k) => k.id)
    case 'arrows':
      return ids.filter((k) => k.zone === 'arrow').map((k) => k.id)
    case 'modifiers':
      return ids.filter((k) => k.zone === 'modifier').map((k) => k.id)
  }
}

// --- validation ------------------------------------------------------------------------------

export function validateChange(change: ConfigChange, layout: KeyboardLayout = DEFAULT_LAYOUT): string[] {
  const errors: string[] = []
  const keyIds = new Set(layout.keys.map((k) => k.id))
  switch (change.type) {
    case 'set-key': {
      if (!keyIds.has(change.keyId)) errors.push(`Unknown key "${change.keyId}".`)
      if (!LAYERS.includes(change.layer)) errors.push(`Unknown layer "${change.layer}".`)
      const a = change.assignment
      if (a.kind === 'key' && !isKeyCode(a.code)) errors.push(`Unknown key code "${a.code}".`)
      if (a.kind === 'macro' && a.macroId.trim() === '') errors.push('Choose a macro.')
      if (a.kind === 'layer' && !LAYERS.includes(a.layer)) errors.push(`Unknown layer "${a.layer}".`)
      break
    }
    case 'set-macro': {
      const m = change.macro
      if (m.id.trim() === '') errors.push('The macro needs an id.')
      if (m.name.trim() === '') errors.push('The macro needs a name.')
      if (m.steps.length === 0) errors.push('The macro needs at least one step.')
      if (m.repeat !== undefined && (!Number.isInteger(m.repeat) || m.repeat < 1 || m.repeat > 255)) {
        errors.push('Repeat must be a whole number from 1 to 255.')
      }
      m.steps.forEach((step, i) => {
        if (step.type === 'key' && !isKeyCode(step.code)) errors.push(`Step ${i + 1}: unknown key code "${step.code}".`)
        if (step.type === 'delay' && (!Number.isInteger(step.ms) || step.ms < 1 || step.ms > 10000)) {
          errors.push(`Step ${i + 1}: delay must be a whole number from 1 to 10000 ms.`)
        }
      })
      break
    }
    case 'remove-macro':
      if (change.macroId.trim() === '') errors.push('The macro id is empty.')
      break
    case 'set-lighting': {
      const l = change.lighting
      if (!LIGHTING_EFFECTS.includes(l.effect)) errors.push(`Unknown effect "${l.effect}".`)
      if (l.brightness < 0 || l.brightness > 100) errors.push('Brightness must be 0-100 percent.')
      if (l.speed < 0 || l.speed > 100) errors.push('Speed must be 0-100 percent.')
      for (const keyId of Object.keys(l.perKey)) {
        if (!keyIds.has(keyId)) errors.push(`Unknown key "${keyId}" in per-key colors.`)
      }
      break
    }
    case 'set-settings':
      break
  }
  return errors
}

// --- apply -----------------------------------------------------------------------------------

export function applyChanges(config: KeyboardConfig, changes: ConfigChange[]): KeyboardConfig {
  const next = clone(config)
  for (const change of changes) {
    switch (change.type) {
      case 'set-key':
        next.layers[change.layer][change.keyId] = clone(change.assignment)
        break
      case 'set-macro': {
        const index = next.macros.findIndex((m) => m.id === change.macro.id)
        if (index >= 0) next.macros[index] = clone(change.macro)
        else next.macros.push(clone(change.macro))
        break
      }
      case 'remove-macro':
        next.macros = next.macros.filter((m) => m.id !== change.macroId)
        break
      case 'set-lighting':
        next.lighting = clone(change.lighting)
        break
      case 'set-settings':
        next.settings = clone(change.settings)
        break
    }
  }
  return next
}

// --- diff ------------------------------------------------------------------------------------

export function describeAssignment(a: KeyAssignment | undefined): string {
  if (!a) return 'unset'
  switch (a.kind) {
    case 'key':
      return a.modifiers && a.modifiers.length > 0 ? `key ${a.modifiers.join('+')}+${a.code}` : `key ${a.code}`
    case 'macro':
      return `macro ${a.macroId}`
    case 'layer':
      return `layer ${a.layer}`
    case 'none':
      return 'none'
  }
}

function flatten(config: KeyboardConfig): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const layer of LAYERS) {
    for (const [keyId, assignment] of Object.entries(config.layers[layer])) out.set(`layers.${layer}.${keyId}`, assignment)
  }
  for (const macro of config.macros) out.set(`macros.${macro.id}`, macro)
  const { perKey, ...lighting } = config.lighting
  for (const [k, v] of Object.entries(lighting)) out.set(`lighting.${k}`, v)
  for (const [keyId, color] of Object.entries(perKey)) out.set(`lighting.perKey.${keyId}`, color)
  for (const [k, v] of Object.entries(config.settings)) out.set(`settings.${k}`, v)
  return out
}

function describeValue(path: string, value: unknown): string {
  if (value === undefined) return 'unset'
  if (path.startsWith('layers.')) return describeAssignment(value as KeyAssignment)
  if (path.startsWith('macros.')) {
    const m = value as { name: string; steps: unknown[] }
    return `"${m.name}" (${m.steps.length} steps)`
  }
  if (typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value) {
    return rgbToHex(value as RGBColor)
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function diffConfig(before: KeyboardConfig, after: KeyboardConfig): ConfigDiffEntry[] {
  const a = flatten(before)
  const b = flatten(after)
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort()
  const entries: ConfigDiffEntry[] = []
  for (const path of paths) {
    const x = a.get(path)
    const y = b.get(path)
    if (canonical(x) === canonical(y)) continue
    const label = path.split('.').slice(path.startsWith('layers.') ? 2 : 1).join('.')
    entries.push({ path, before: x, after: y, description: `${label}: ${describeValue(path, x)} -> ${describeValue(path, y)}` })
  }
  return entries
}

// --- lighting input -> state (service behavior, mirrored here for the mock and the draft preview) ----

/**
 * Applies a `LightingPlanInput` to the current lighting. The real service owns this mapping; the UI uses it only
 * to preview an unsent draft. Precedence: `base`, then `zones`, then `perKey`. Any of those switches the
 * effect to `per-key` unless `effect` is given.
 */
export function lightingInputToState(
  current: LightingState,
  input: LightingPlanInput,
  layout: KeyboardLayout = DEFAULT_LAYOUT,
): LightingState {
  const next = clone(current)
  const painted: Record<string, RGBColor> = {}
  let usesPerKey = false

  if (input.base) {
    const rgb = hexToRgb(input.base)
    if (rgb) {
      usesPerKey = true
      for (const key of layout.keys) painted[key.id] = rgb
    }
  }
  for (const [zone, hex] of Object.entries(input.zones ?? {}) as [LightingZone, HexColor][]) {
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    usesPerKey = true
    for (const id of zoneKeys(zone, layout)) painted[id] = rgb
  }
  for (const [id, hex] of Object.entries(input.perKey ?? {})) {
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    usesPerKey = true
    painted[id] = rgb
  }
  if (usesPerKey) next.perKey = { ...next.perKey, ...painted }

  if (input.color) {
    const rgb = hexToRgb(input.color)
    if (rgb) next.color = rgb
  }
  if (input.brightness !== undefined) next.brightness = input.brightness
  if (input.speed !== undefined) next.speed = input.speed
  if (input.direction !== undefined) next.direction = input.direction
  if (input.effect) next.effect = input.effect
  else if (usesPerKey) next.effect = 'per-key'
  next.enabled = next.effect !== 'off'
  return next
}
