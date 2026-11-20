/**
 * Pure helpers over the semantic model: revisions, changes, diffs, zones, colors, validation.
 * No I/O, no Node or DOM dependency.
 *
 * Normal form: a layer entry of kind `none` is the same thing as a missing entry
 * (`assignmentFor` returns `none` for both). `applyChanges` removes `none` entries and
 * `configRevision` ignores them, so two configs that diff as equal have the same revision.
 */
import { cloneConfig } from './config.js'
import { isKeyCode, isMacroKeyCode } from './keys.js'
import { DEFAULT_LAYOUT } from './layout.js'
import { sha256Hex } from './protocol/hash.js'
import { MACRO_MAX_ACTIONS, macroActionCount } from './protocol/macro.js'
import type { ConfigDiffEntry, HexColor, LightingZone } from './service.js'
import {
  LAYERS,
  LIGHTING_EFFECTS,
  type ConfigChange,
  type KeyAssignment,
  type KeyboardConfig,
  type KeyboardLayout,
  type Macro,
  type MacroStep,
  type Modifier,
  type RGBColor,
} from './types.js'

const MODIFIERS: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'gui']
const NONE: KeyAssignment = { kind: 'none' }

// ---------------------------------------------------------------------------
// Canonical JSON and revision
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) out[key] = canonicalize(item)
    }
    return out
  }
  return value
}

/** Same config minus the `none` entries, which are equivalent to missing entries. */
function normalized(config: KeyboardConfig): KeyboardConfig {
  const copy = cloneConfig(config)
  for (const layer of LAYERS) {
    const entries = copy.layers[layer]
    for (const keyId of Object.keys(entries)) {
      if (entries[keyId]?.kind === 'none') delete entries[keyId]
    }
  }
  return copy
}

/** Stable digest (16 hex chars of SHA-256) of the canonical JSON of the config. */
export function configRevision(config: KeyboardConfig): string {
  return sha256Hex(JSON.stringify(canonicalize(normalized(config)))).slice(0, 16)
}

// ---------------------------------------------------------------------------
// applyChanges
// ---------------------------------------------------------------------------

/** Applies changes in order to a copy of the config. Does not validate, see `validateChange`. */
export function applyChanges(config: KeyboardConfig, changes: ConfigChange[]): KeyboardConfig {
  const next = cloneConfig(config)

  for (const change of changes) {
    switch (change.type) {
      case 'set-key': {
        const entries = next.layers[change.layer]
        if (change.assignment.kind === 'none') {
          delete entries[change.keyId]
        } else {
          entries[change.keyId] = structuredCloneJson(change.assignment)
        }
        break
      }
      case 'set-macro': {
        const macro = structuredCloneJson(change.macro)
        const index = next.macros.findIndex((item) => item.id === macro.id)
        if (index >= 0) next.macros[index] = macro
        else next.macros.push(macro)
        break
      }
      case 'remove-macro':
        next.macros = next.macros.filter((item) => item.id !== change.macroId)
        break
      case 'set-lighting':
        next.lighting = structuredCloneJson(change.lighting)
        break
      case 'set-settings':
        next.settings = structuredCloneJson(change.settings)
        break
    }
  }
  return next
}

function structuredCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------------------------------------------------------------------------
// diffConfig
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

export function describeAssignment(assignment: KeyAssignment): string {
  switch (assignment.kind) {
    case 'key': {
      const modifiers = assignment.modifiers ?? []
      return `key ${[...modifiers, assignment.code].join('+')}`
    }
    case 'macro':
      return `macro ${assignment.macroId}`
    case 'layer':
      return `layer ${assignment.layer}`
    case 'none':
      return 'none'
  }
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'unset'
  if (typeof value === 'object' && value !== null) {
    const color = value as Partial<RGBColor>
    if (typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
      return rgbToHex({ r: color.r, g: color.g, b: color.b })
    }
    return JSON.stringify(canonicalize(value))
  }
  return String(value)
}

/**
 * Differences between two configs, in a stable order: layers (in `LAYERS` order, key ids sorted),
 * macros, lighting, settings. Paths look like `layers.base.capslock` or `lighting.effect`.
 */
export function diffConfig(before: KeyboardConfig, after: KeyboardConfig): ConfigDiffEntry[] {
  const entries: ConfigDiffEntry[] = []

  for (const layer of LAYERS) {
    const a = before.layers[layer]
    const b = after.layers[layer]
    const keyIds = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const keyId of keyIds) {
      const left = a[keyId] ?? NONE
      const right = b[keyId] ?? NONE
      if (deepEqual(left, right)) continue
      const label = layer === 'base' ? keyId : `${layer} ${keyId}`
      entries.push({
        path: `layers.${layer}.${keyId}`,
        before: left,
        after: right,
        description: `${label}: ${describeAssignment(left)} -> ${describeAssignment(right)}`,
      })
    }
  }

  const beforeMacros = new Map(before.macros.map((macro) => [macro.id, macro]))
  const afterMacros = new Map(after.macros.map((macro) => [macro.id, macro]))
  for (const id of [...new Set([...beforeMacros.keys(), ...afterMacros.keys()])].sort()) {
    const left = beforeMacros.get(id)
    const right = afterMacros.get(id)
    if (deepEqual(left, right)) continue
    const verb = left === undefined ? 'added' : right === undefined ? 'removed' : 'changed'
    entries.push({ path: `macros.${id}`, before: left, after: right, description: `macro ${id}: ${verb}` })
  }
  const commonBefore = before.macros.map((macro) => macro.id).filter((id) => afterMacros.has(id))
  const commonAfter = after.macros.map((macro) => macro.id).filter((id) => beforeMacros.has(id))
  if (!deepEqual(commonBefore, commonAfter)) {
    entries.push({
      path: 'macros.order',
      before: commonBefore,
      after: commonAfter,
      description: 'macro order changed',
    })
  }

  const lightingFields = ['enabled', 'effect', 'color', 'brightness', 'speed', 'direction'] as const
  for (const field of lightingFields) {
    const left: unknown = before.lighting[field]
    const right: unknown = after.lighting[field]
    if (deepEqual(left, right)) continue
    entries.push({
      path: `lighting.${field}`,
      before: left,
      after: right,
      description: `lighting ${field}: ${describeValue(left)} -> ${describeValue(right)}`,
    })
  }
  const perKeyIds = [...new Set([...Object.keys(before.lighting.perKey), ...Object.keys(after.lighting.perKey)])].sort()
  for (const keyId of perKeyIds) {
    const left = before.lighting.perKey[keyId]
    const right = after.lighting.perKey[keyId]
    if (deepEqual(left, right)) continue
    entries.push({
      path: `lighting.perKey.${keyId}`,
      before: left,
      after: right,
      description: `${keyId} color: ${describeValue(left)} -> ${describeValue(right)}`,
    })
  }

  const settingsFields = ['nkro', 'osMode', 'sleepMinutes'] as const
  for (const field of settingsFields) {
    const left: unknown = before.settings[field]
    const right: unknown = after.settings[field]
    if (deepEqual(left, right)) continue
    entries.push({
      path: `settings.${field}`,
      before: left,
      after: right,
      description: `setting ${field}: ${describeValue(left)} -> ${describeValue(right)}`,
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const ARROW_IDS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']
const WASD_IDS = ['w', 'a', 's', 'd']

/** Key ids of a zone, in layout order. Only ids present in the layout are returned. */
export function zoneKeys(zone: LightingZone, layout: KeyboardLayout = DEFAULT_LAYOUT): string[] {
  const ids = layout.keys
    .filter((key) => {
      switch (zone) {
        case 'wasd':
          return WASD_IDS.includes(key.id)
        case 'alphanumeric':
          return /^[a-z]$/.test(key.id) || /^digit[0-9]$/.test(key.id)
        case 'top-row':
          return key.row === 0
        case 'arrows':
          return ARROW_IDS.includes(key.id)
        case 'modifiers':
          return key.zone === 'modifier'
      }
    })
    .map((key) => key.id)
  return ids
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/

export function hexToRgb(hex: string): RGBColor | undefined {
  const match = HEX_COLOR.exec(hex)
  if (match === null) return undefined
  return {
    r: Number.parseInt(match[1] as string, 16),
    g: Number.parseInt(match[2] as string, 16),
    b: Number.parseInt(match[3] as string, 16),
  }
}

/** Lowercase `#rrggbb`. Channels are rounded and clamped to 0-255. */
export function rgbToHex(color: RGBColor): HexColor {
  const channel = (value: number): string => {
    const clamped = Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0
    return clamped.toString(16).padStart(2, '0')
  }
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

// ---------------------------------------------------------------------------
// validateChange
// ---------------------------------------------------------------------------

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function validateColor(color: unknown, label: string): string[] {
  if (typeof color !== 'object' || color === null) return [`${label} must be an RGB object`]
  const errors: string[] = []
  for (const channel of ['r', 'g', 'b'] as const) {
    if (!isIntegerInRange((color as Record<string, unknown>)[channel], 0, 255)) {
      errors.push(`${label}.${channel} must be an integer between 0 and 255`)
    }
  }
  return errors
}

function validateModifiers(modifiers: unknown, label: string): string[] {
  if (modifiers === undefined) return []
  if (!Array.isArray(modifiers)) return [`${label} must be an array`]
  return modifiers
    .filter((modifier) => !MODIFIERS.includes(modifier as Modifier))
    .map((modifier) => `${label}: unknown modifier ${JSON.stringify(modifier)}`)
}

function validateAssignment(assignment: KeyAssignment, keyId: string): string[] {
  const errors: string[] = []
  switch (assignment.kind) {
    case 'key': {
      if (typeof assignment.code !== 'string' || !isKeyCode(assignment.code)) {
        errors.push(`Unknown key code ${JSON.stringify(assignment.code)}`)
        break
      }
      errors.push(...validateModifiers(assignment.modifiers, 'modifiers'))
      // The reference tool states that the Fn key cannot be reprogrammed and has no key value.
      if (assignment.code === 'fn' && keyId !== 'fn') {
        errors.push('The fn code can only be assigned to the fn key')
      }
      if (keyId === 'fn' && assignment.code !== 'fn') {
        errors.push('The fn key cannot be reprogrammed')
      }
      if ((assignment.modifiers?.length ?? 0) > 0 && !isMacroKeyCode(assignment.code)) {
        errors.push(`Modifiers cannot be combined with ${assignment.code}`)
      }
      break
    }
    case 'macro':
      if (typeof assignment.macroId !== 'string' || assignment.macroId === '') {
        errors.push('macroId must be a non-empty string')
      }
      break
    case 'layer':
      if (!LAYERS.includes(assignment.layer)) errors.push(`Unknown layer ${JSON.stringify(assignment.layer)}`)
      break
    case 'none':
      if (keyId === 'fn') errors.push('The fn key cannot be reprogrammed')
      break
    default:
      errors.push(`Unknown assignment kind ${JSON.stringify((assignment as { kind?: unknown }).kind)}`)
  }
  return errors
}

function validateMacroSteps(steps: readonly MacroStep[]): string[] {
  const errors: string[] = []
  steps.forEach((step, index) => {
    const label = `steps[${index}]`
    if (step.type === 'key') {
      if (typeof step.code !== 'string' || !isKeyCode(step.code)) {
        errors.push(`${label}: unknown key code ${JSON.stringify(step.code)}`)
      } else if (!isMacroKeyCode(step.code)) {
        errors.push(`${label}: ${step.code} cannot be used in a macro`)
      }
      errors.push(...validateModifiers(step.modifiers, `${label}.modifiers`))
    } else if (step.type === 'delay') {
      if (!isIntegerInRange(step.ms, 0, 0xffff)) errors.push(`${label}: ms must be an integer between 0 and 65535`)
    } else {
      errors.push(`${label}: unknown step type ${JSON.stringify((step as { type?: unknown }).type)}`)
    }
  })
  if (errors.length > 0) return errors

  if (!steps.some((step) => step.type === 'key')) errors.push('A macro needs at least one key step')
  if (steps[0]?.type === 'delay') errors.push('A macro cannot start with a delay step')
  const actions = macroActionCount(steps)
  if (actions > MACRO_MAX_ACTIONS) {
    errors.push(`Macro expands to ${actions} device actions, the limit is ${MACRO_MAX_ACTIONS}`)
  }
  return errors
}

function validateMacro(macro: Macro): string[] {
  const errors: string[] = []
  if (typeof macro.id !== 'string' || macro.id === '') errors.push('Macro id must be a non-empty string')
  if (typeof macro.name !== 'string') errors.push('Macro name must be a string')
  if (macro.repeat !== undefined && !isIntegerInRange(macro.repeat, 1, 255)) {
    errors.push('repeat must be an integer between 1 and 255')
  }
  if (!Array.isArray(macro.steps)) return [...errors, 'steps must be an array']
  return [...errors, ...validateMacroSteps(macro.steps)]
}

/** Returns error messages. An empty array means the change is valid. */
export function validateChange(change: ConfigChange, layout: KeyboardLayout = DEFAULT_LAYOUT): string[] {
  switch (change.type) {
    case 'set-key': {
      const errors: string[] = []
      if (!LAYERS.includes(change.layer)) errors.push(`Unknown layer ${JSON.stringify(change.layer)}`)
      if (!layout.keys.some((key) => key.id === change.keyId)) {
        errors.push(`Unknown key id ${JSON.stringify(change.keyId)}`)
      }
      if (typeof change.assignment !== 'object' || change.assignment === null) {
        errors.push('assignment must be an object')
        return errors
      }
      return [...errors, ...validateAssignment(change.assignment, change.keyId)]
    }
    case 'set-macro':
      return validateMacro(change.macro)
    case 'remove-macro':
      return typeof change.macroId === 'string' && change.macroId !== '' ? [] : ['macroId must be a non-empty string']
    case 'set-lighting': {
      const lighting = change.lighting
      const errors: string[] = []
      if (typeof lighting.enabled !== 'boolean') errors.push('enabled must be a boolean')
      if (!LIGHTING_EFFECTS.includes(lighting.effect)) errors.push(`Unknown lighting effect ${JSON.stringify(lighting.effect)}`)
      errors.push(...validateColor(lighting.color, 'color'))
      if (!isIntegerInRange(lighting.brightness, 0, 100)) errors.push('brightness must be an integer between 0 and 100')
      if (!isIntegerInRange(lighting.speed, 0, 100)) errors.push('speed must be an integer between 0 and 100')
      if (!isIntegerInRange(lighting.direction, 0, 0xff)) errors.push('direction must be an integer between 0 and 255')
      for (const [keyId, color] of Object.entries(lighting.perKey ?? {})) {
        if (!layout.keys.some((key) => key.id === keyId)) errors.push(`perKey: unknown key id ${JSON.stringify(keyId)}`)
        errors.push(...validateColor(color, `perKey.${keyId}`))
      }
      return errors
    }
    case 'set-settings': {
      const settings = change.settings
      const errors: string[] = []
      if (typeof settings.nkro !== 'boolean') errors.push('nkro must be a boolean')
      if (settings.osMode !== 'win' && settings.osMode !== 'mac') errors.push('osMode must be "win" or "mac"')
      if (settings.sleepMinutes !== undefined && !isIntegerInRange(settings.sleepMinutes, 0, 0xffff)) {
        errors.push('sleepMinutes must be an integer between 0 and 65535')
      }
      return errors
    }
    default:
      return [`Unknown change type ${JSON.stringify((change as { type?: unknown }).type)}`]
  }
}
