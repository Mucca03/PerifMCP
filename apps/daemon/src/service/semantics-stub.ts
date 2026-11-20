/**
 * TEMPORARY adapter for the protocol agent's phase 1 (`semantics.ts`, `keys.ts` in
 * `@perifmcp/core`). Same names and signatures as docs/agents/protocol.md.
 *
 * The master swaps it by replacing the import in every daemon file that reads
 * `./semantics-stub.js` (or `../service/semantics-stub.js`) with `@perifmcp/core`, then
 * deleting this file. Nothing else in the daemon depends on its internals.
 *
 * Key codes are derived from the layout key ids (the protocol brief says the real table uses
 * the same ids, built from the public USB HID usage table).
 */
import { DEFAULT_LAYOUT, LAYERS, LIGHTING_EFFECTS, cloneConfig } from '@perifmcp/core'
import type {
  ConfigChange,
  ConfigDiffEntry,
  HexColor,
  KeyAssignment,
  KeyboardConfig,
  KeyboardLayout,
  LightingZone,
  Macro,
  RGBColor,
} from '@perifmcp/core'
import {
  CONTROL_CHARS_RE,
  HEX_COLOR_RE,
  MACRO_ID_RE,
  MAX_KEY_MODIFIERS,
  MAX_MACRO_DELAY_MS,
  MAX_MACRO_ID_LENGTH,
  MAX_MACRO_NAME_LENGTH,
  MAX_MACRO_REPEAT,
  MAX_MACRO_STEPS,
  MIN_MACRO_REPEAT,
} from '../limits.js'

// ---------------------------------------------------------------------------
// keys.ts
// ---------------------------------------------------------------------------

export const KEY_CODES: readonly string[] = DEFAULT_LAYOUT.keys.map((key) => key.id)

const KEY_CODE_SET = new Set(KEY_CODES)

export function isKeyCode(code: string): boolean {
  return KEY_CODE_SET.has(code)
}

// ---------------------------------------------------------------------------
// semantics.ts
// ---------------------------------------------------------------------------

const MODIFIERS = ['ctrl', 'shift', 'alt', 'gui']

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** cyrb53 string hash. Not cryptographic; only has to change when the config changes. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}

export function configRevision(config: KeyboardConfig): string {
  return hash53(canonicalJson(config))
}

export function applyChanges(config: KeyboardConfig, changes: ConfigChange[]): KeyboardConfig {
  const next = cloneConfig(config)
  for (const change of changes) {
    switch (change.type) {
      case 'set-key':
        next.layers[change.layer][change.keyId] = JSON.parse(JSON.stringify(change.assignment)) as KeyAssignment
        break
      case 'set-macro': {
        const macro = JSON.parse(JSON.stringify(change.macro)) as Macro
        const index = next.macros.findIndex((item) => item.id === macro.id)
        if (index >= 0) next.macros[index] = macro
        else next.macros.push(macro)
        break
      }
      case 'remove-macro':
        next.macros = next.macros.filter((item) => item.id !== change.macroId)
        break
      case 'set-lighting':
        next.lighting = JSON.parse(JSON.stringify(change.lighting)) as KeyboardConfig['lighting']
        break
      case 'set-settings':
        next.settings = JSON.parse(JSON.stringify(change.settings)) as KeyboardConfig['settings']
        break
    }
  }
  return next
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function describeAssignment(assignment: KeyAssignment | undefined): string {
  if (assignment === undefined) return 'none'
  switch (assignment.kind) {
    case 'key': {
      const modifiers = assignment.modifiers?.length ? `${assignment.modifiers.join('+')}+` : ''
      return `key ${modifiers}${assignment.code}`
    }
    case 'macro':
      return `macro ${assignment.macroId}`
    case 'layer':
      return `layer ${assignment.layer}`
    case 'none':
      return 'none'
  }
}

function describeColor(color: RGBColor | undefined): string {
  return color === undefined ? 'off' : rgbToHex(color)
}

function describeValue(value: unknown): string {
  return typeof value === 'object' ? canonicalJson(value) : String(value)
}

export function diffConfig(before: KeyboardConfig, after: KeyboardConfig): ConfigDiffEntry[] {
  const entries: ConfigDiffEntry[] = []

  for (const layer of LAYERS) {
    const left = before.layers[layer]
    const right = after.layers[layer]
    const ids = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const id of ids) {
      const a = left[id] ?? { kind: 'none' as const }
      const b = right[id] ?? { kind: 'none' as const }
      if (same(a, b)) continue
      entries.push({
        path: `layers.${layer}.${id}`,
        before: a,
        after: b,
        description: `${layer}/${id}: ${describeAssignment(a)} -> ${describeAssignment(b)}`,
      })
    }
  }

  const leftMacros = new Map(before.macros.map((macro) => [macro.id, macro]))
  const rightMacros = new Map(after.macros.map((macro) => [macro.id, macro]))
  for (const id of [...new Set([...leftMacros.keys(), ...rightMacros.keys()])].sort()) {
    const a = leftMacros.get(id)
    const b = rightMacros.get(id)
    if (same(a, b)) continue
    const description =
      a === undefined ? `macro ${id}: added` : b === undefined ? `macro ${id}: removed` : `macro ${id}: changed`
    entries.push({ path: `macros.${id}`, before: a, after: b, description })
  }

  const left = before.lighting
  const right = after.lighting
  for (const field of ['enabled', 'effect', 'brightness', 'speed', 'direction'] as const) {
    if (left[field] === right[field]) continue
    entries.push({
      path: `lighting.${field}`,
      before: left[field],
      after: right[field],
      description: `lighting ${field}: ${describeValue(left[field])} -> ${describeValue(right[field])}`,
    })
  }
  if (!same(left.color, right.color)) {
    entries.push({
      path: 'lighting.color',
      before: left.color,
      after: right.color,
      description: `lighting color: ${describeColor(left.color)} -> ${describeColor(right.color)}`,
    })
  }
  const perKeyIds = [...new Set([...Object.keys(left.perKey), ...Object.keys(right.perKey)])].sort()
  for (const id of perKeyIds) {
    const a = left.perKey[id]
    const b = right.perKey[id]
    if (same(a, b)) continue
    entries.push({
      path: `lighting.perKey.${id}`,
      before: a,
      after: b,
      description: `${id} light: ${describeColor(a)} -> ${describeColor(b)}`,
    })
  }

  for (const field of ['nkro', 'osMode', 'sleepMinutes'] as const) {
    if (before.settings[field] === after.settings[field]) continue
    entries.push({
      path: `settings.${field}`,
      before: before.settings[field],
      after: after.settings[field],
      description: `setting ${field}: ${describeValue(before.settings[field])} -> ${describeValue(after.settings[field])}`,
    })
  }

  return entries
}

export function zoneKeys(zone: LightingZone, layout: KeyboardLayout = DEFAULT_LAYOUT): string[] {
  const ids = layout.keys.map((key) => key.id)
  const exists = new Set(ids)
  switch (zone) {
    case 'wasd':
      return ['w', 'a', 's', 'd'].filter((id) => exists.has(id))
    case 'alphanumeric':
      return ids.filter((id) => /^[a-z]$/.test(id) || /^digit[0-9]$/.test(id))
    case 'top-row':
      return layout.keys.filter((key) => key.row === 0).map((key) => key.id)
    case 'arrows':
      return ids.filter((id) => id.startsWith('arrow'))
    case 'modifiers':
      return layout.keys.filter((key) => key.zone === 'modifier').map((key) => key.id)
  }
}

export function hexToRgb(hex: string): RGBColor | undefined {
  if (!HEX_COLOR_RE.test(hex)) return undefined
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

export function rgbToHex(color: RGBColor): HexColor {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

function isByte(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

function isPercent(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
}

function validateModifiers(modifiers: unknown, errors: string[], where: string): void {
  if (modifiers === undefined) return
  if (!Array.isArray(modifiers) || modifiers.length > MAX_KEY_MODIFIERS) {
    errors.push(`${where}: modifiers must be an array of at most ${MAX_KEY_MODIFIERS} items`)
    return
  }
  for (const modifier of modifiers) {
    if (typeof modifier !== 'string' || !MODIFIERS.includes(modifier)) {
      errors.push(`${where}: unknown modifier`)
    }
  }
}

function validateAssignment(assignment: KeyAssignment, errors: string[], where: string): void {
  switch (assignment.kind) {
    case 'key':
      if (typeof assignment.code !== 'string' || !isKeyCode(assignment.code)) {
        errors.push(`${where}: unknown key code`)
      }
      validateModifiers(assignment.modifiers, errors, where)
      break
    case 'macro':
      if (
        typeof assignment.macroId !== 'string' ||
        assignment.macroId.length === 0 ||
        assignment.macroId.length > MAX_MACRO_ID_LENGTH ||
        !MACRO_ID_RE.test(assignment.macroId)
      ) {
        errors.push(`${where}: invalid macro id`)
      }
      break
    case 'layer':
      if (!(LAYERS as readonly string[]).includes(assignment.layer)) errors.push(`${where}: unknown layer`)
      break
    case 'none':
      break
    default:
      errors.push(`${where}: unknown assignment kind`)
  }
}

function validateMacro(macro: Macro, errors: string[]): void {
  if (
    typeof macro.id !== 'string' ||
    macro.id.length === 0 ||
    macro.id.length > MAX_MACRO_ID_LENGTH ||
    !MACRO_ID_RE.test(macro.id)
  ) {
    errors.push('macro: invalid id')
  }
  if (
    typeof macro.name !== 'string' ||
    macro.name.length === 0 ||
    macro.name.length > MAX_MACRO_NAME_LENGTH ||
    CONTROL_CHARS_RE.test(macro.name)
  ) {
    errors.push('macro: invalid name')
  }
  if (!Array.isArray(macro.steps) || macro.steps.length === 0 || macro.steps.length > MAX_MACRO_STEPS) {
    errors.push(`macro: steps must contain 1 to ${MAX_MACRO_STEPS} items`)
  } else {
    macro.steps.forEach((step, index) => {
      const where = `macro step ${index + 1}`
      if (step.type === 'key') {
        if (typeof step.code !== 'string' || !isKeyCode(step.code)) errors.push(`${where}: unknown key code`)
        validateModifiers(step.modifiers, errors, where)
      } else if (step.type === 'delay') {
        if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > MAX_MACRO_DELAY_MS) {
          errors.push(`${where}: delay must be an integer from 0 to ${MAX_MACRO_DELAY_MS} ms`)
        }
      } else {
        errors.push(`${where}: unknown step type`)
      }
    })
  }
  if (
    macro.repeat !== undefined &&
    (!Number.isInteger(macro.repeat) || macro.repeat < MIN_MACRO_REPEAT || macro.repeat > MAX_MACRO_REPEAT)
  ) {
    errors.push(`macro: repeat must be an integer from ${MIN_MACRO_REPEAT} to ${MAX_MACRO_REPEAT}`)
  }
}

export function validateChange(change: ConfigChange, layout: KeyboardLayout = DEFAULT_LAYOUT): string[] {
  const errors: string[] = []
  const keyIds = new Set(layout.keys.map((key) => key.id))

  switch (change.type) {
    case 'set-key':
      if (!(LAYERS as readonly string[]).includes(change.layer)) errors.push(`unknown layer`)
      if (!keyIds.has(change.keyId)) errors.push(`unknown key id`)
      validateAssignment(change.assignment, errors, `key ${change.keyId}`)
      break
    case 'set-macro':
      validateMacro(change.macro, errors)
      break
    case 'remove-macro':
      if (typeof change.macroId !== 'string' || !MACRO_ID_RE.test(change.macroId)) errors.push('invalid macro id')
      break
    case 'set-lighting': {
      const lighting = change.lighting
      if (typeof lighting.enabled !== 'boolean') errors.push('lighting: enabled must be a boolean')
      if (!(LIGHTING_EFFECTS as readonly string[]).includes(lighting.effect)) errors.push('lighting: unknown effect')
      if (!isPercent(lighting.brightness)) errors.push('lighting: brightness must be an integer from 0 to 100')
      if (!isPercent(lighting.speed)) errors.push('lighting: speed must be an integer from 0 to 100')
      if (!isByte(lighting.direction)) errors.push('lighting: direction must be an integer from 0 to 255')
      const colors: Array<[string, RGBColor]> = [['color', lighting.color]]
      for (const [id, color] of Object.entries(lighting.perKey)) {
        if (!keyIds.has(id)) errors.push('lighting: unknown key id in perKey')
        colors.push([`perKey ${id}`, color])
      }
      for (const [name, color] of colors) {
        if (!isByte(color.r) || !isByte(color.g) || !isByte(color.b)) {
          errors.push(`lighting: ${name} must have r, g, b integers from 0 to 255`)
        }
      }
      break
    }
    case 'set-settings': {
      const settings = change.settings
      if (typeof settings.nkro !== 'boolean') errors.push('settings: nkro must be a boolean')
      if (settings.osMode !== 'win' && settings.osMode !== 'mac') errors.push('settings: osMode must be win or mac')
      if (
        settings.sleepMinutes !== undefined &&
        (!Number.isInteger(settings.sleepMinutes) || settings.sleepMinutes < 0 || settings.sleepMinutes > 1440)
      ) {
        errors.push('settings: sleepMinutes must be an integer from 0 to 1440')
      }
      break
    }
    default:
      errors.push('unknown change type')
  }
  return errors
}
