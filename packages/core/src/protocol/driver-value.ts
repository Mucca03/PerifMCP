/**
 * Key values ("driver values"): the 32-bit number stored per key in a key set (0x22 / 0x31).
 *
 * Source: GK6X/KeyValues.cs (`GetKeyType`, `GetKeyData1`, `GetKeyData2`, `DriverValueType`,
 * `DriverValueModifer`, `IsKeyModifier`, `UnusedKeyValue`) and the `DriverValue` enum, GK6X/UserDataFile.cs
 * (modifier OR in the layer parser, macro value `0x0A010000 + id`).
 * Usage numbers are the public USB HID values, see `keycodes.ts`.
 *
 *   keyboard key   0x02 00 UU MM   UU = HID keyboard usage, MM = modifier bit mask (OR-ed in)
 *   modifier key   0x02 00 00 MM   one bit in MM
 *   disabled       0x02 00 00 00
 *   consumer key   0x03 00 UU UU   HID consumer usage (16 bit)
 *   macro          0x0A 01 00 II   II = macro index
 *   layer switch   0x0A 07 00 LL   LL = device layer number (1 base, 2..4 layer 1..3, 5 driver), temporary switch
 *   unused         0xFFFFFFFF      keep the firmware default
 */
import type { KeyAssignment, Layer, Modifier } from '../types.js'
import { DEVICE_LAYER, type DeviceLayer } from './framing.js'
import {
  CONSUMER_USAGE,
  CONSUMER_USAGE_BY_VALUE,
  KEYBOARD_USAGE,
  KEYBOARD_USAGE_BY_VALUE,
  MODIFIER_BITS,
  MODIFIER_CODE_BY_BIT,
  MODIFIER_KEY_BITS,
} from './keycodes.js'

export const UNUSED_KEY_VALUE = 0xffffffff
export const DISABLED_KEY_VALUE = 0x02000000

const TYPE_KEY = 0x0200
const TYPE_CONSUMER = 0x0300
const TYPE_MACRO = 0x0a01
const TYPE_TEMP_SWITCH_LAYER = 0x0a07

const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'gui']

/**
 * Which device layer and key table each semantic layer is written to.
 *
 * unverified: the contract has `base, fn1, fn2, fn3` and the reference has `Base, Layer1..3` (each with a
 * normal and an Fn key table, plus the "driver" layer). Which semantic layer maps to which table is a
 * decision for the master. The default writes `fn1..fn3` to the normal tables of device layers 1..3, which
 * leaves the base layer's Fn table (Fn+key combinations) alone.
 */
export interface LayerTarget {
  layer: DeviceLayer
  /** True for the Fn key table (command 0x31), false for the normal table (command 0x22). */
  fn: boolean
}

export type LayerTargets = Readonly<Record<Layer, LayerTarget>>

export const DEFAULT_LAYER_TARGETS: LayerTargets = {
  base: { layer: DEVICE_LAYER.base, fn: false },
  fn1: { layer: DEVICE_LAYER.layer1, fn: false },
  fn2: { layer: DEVICE_LAYER.layer2, fn: false },
  fn3: { layer: DEVICE_LAYER.layer3, fn: false },
}

export interface DriverValueContext {
  /** Index of a macro on the device, or undefined when the macro does not exist. */
  macroIndex(macroId: string): number | undefined
  layerTargets?: LayerTargets
}

export class UnencodableAssignmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnencodableAssignmentError'
  }
}

function modifierMask(modifiers: readonly Modifier[] | undefined): number {
  let mask = 0
  for (const modifier of modifiers ?? []) mask |= MODIFIER_BITS[modifier]
  return mask
}

/** Encodes one assignment. Throws `UnencodableAssignmentError` for values the firmware has no key value for. */
export function assignmentToDriverValue(assignment: KeyAssignment, context: DriverValueContext): number {
  switch (assignment.kind) {
    case 'none':
      return UNUSED_KEY_VALUE
    case 'macro': {
      const index = context.macroIndex(assignment.macroId)
      if (index === undefined) throw new UnencodableAssignmentError(`Unknown macro ${JSON.stringify(assignment.macroId)}`)
      if (!Number.isInteger(index) || index < 0 || index > 0xff) {
        throw new UnencodableAssignmentError(`Macro index ${index} does not fit a byte`)
      }
      return ((TYPE_MACRO << 16) | index) >>> 0
    }
    case 'layer': {
      const targets = context.layerTargets ?? DEFAULT_LAYER_TARGETS
      const target = targets[assignment.layer]
      // unverified: temporary switch (0x0A07) versus the layer buttons (0x0A06). The reference documents both.
      return ((TYPE_TEMP_SWITCH_LAYER << 16) | target.layer) >>> 0
    }
    case 'key': {
      const { code } = assignment
      const modifiers = modifierMask(assignment.modifiers)
      if (code === 'disabled') return DISABLED_KEY_VALUE
      if (code === 'fn') {
        throw new UnencodableAssignmentError('The reference tool has no key value for the Fn key')
      }
      const modifierKey = MODIFIER_KEY_BITS[code]
      if (modifierKey !== undefined) return ((TYPE_KEY << 16) | modifierKey | modifiers) >>> 0
      const usage = KEYBOARD_USAGE[code]
      if (usage !== undefined) return ((TYPE_KEY << 16) | (usage << 8) | modifiers) >>> 0
      const consumer = CONSUMER_USAGE[code]
      if (consumer !== undefined) {
        if (modifiers !== 0) throw new UnencodableAssignmentError(`Modifiers cannot be combined with ${code}`)
        return ((TYPE_CONSUMER << 16) | consumer) >>> 0
      }
      throw new UnencodableAssignmentError(`Unknown key code ${JSON.stringify(code)}`)
    }
  }
}

export interface DriverValueDecodeContext {
  /** Id of the macro at a device index, if any. */
  macroId(index: number): string | undefined
  layerTargets?: LayerTargets
}

/**
 * Decodes one key value. Returns `undefined` for values with no semantic equivalent (right-hand modifier
 * combinations, mouse buttons, lighting keys, ...). The caller keeps the raw number.
 */
export function driverValueToAssignment(value: number, context: DriverValueDecodeContext): KeyAssignment | undefined {
  const raw = value >>> 0
  if (raw === UNUSED_KEY_VALUE) return { kind: 'none' }
  if (raw === DISABLED_KEY_VALUE) return { kind: 'key', code: 'disabled' }

  const type = raw >>> 16
  const data1 = (raw >>> 8) & 0xff
  const data2 = raw & 0xff

  switch (type) {
    case TYPE_KEY: {
      if (data1 === 0) {
        const code = MODIFIER_CODE_BY_BIT.get(data2)
        return code === undefined ? undefined : { kind: 'key', code }
      }
      const code = KEYBOARD_USAGE_BY_VALUE.get(data1)
      if (code === undefined) return undefined
      // Only the four left-hand modifier bits exist in the semantic model.
      if ((data2 & 0xf0) !== 0) return undefined
      const modifiers = MODIFIER_ORDER.filter((modifier) => (data2 & MODIFIER_BITS[modifier]) !== 0)
      return modifiers.length > 0 ? { kind: 'key', code, modifiers } : { kind: 'key', code }
    }
    case TYPE_CONSUMER: {
      const code = CONSUMER_USAGE_BY_VALUE.get(raw & 0xffff)
      return code === undefined ? undefined : { kind: 'key', code }
    }
    case TYPE_MACRO: {
      if (data1 !== 0) return undefined
      const macroId = context.macroId(data2)
      return macroId === undefined ? undefined : { kind: 'macro', macroId }
    }
    case TYPE_TEMP_SWITCH_LAYER: {
      if (data1 !== 0) return undefined
      const targets = context.layerTargets ?? DEFAULT_LAYER_TARGETS
      const layer = (Object.keys(targets) as Layer[]).find((name) => targets[name].layer === data2)
      return layer === undefined ? undefined : { kind: 'layer', layer }
    }
    default:
      return undefined
  }
}
