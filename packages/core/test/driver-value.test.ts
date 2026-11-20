import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_TARGETS,
  DISABLED_KEY_VALUE,
  KEY_CODES,
  UNUSED_KEY_VALUE,
  UnencodableAssignmentError,
  assignmentToDriverValue,
  driverValueToAssignment,
  type KeyAssignment,
  type Modifier,
} from '../src/index.js'

const encodeContext = { macroIndex: (id: string) => ({ first: 0, second: 3 })[id as 'first'] }
const decodeContext = { macroId: (index: number) => (index === 3 ? 'second' : index === 0 ? 'first' : undefined) }
const encode = (assignment: KeyAssignment): number => assignmentToDriverValue(assignment, encodeContext)

describe('driver values', () => {
  // Expected numbers are the values documented in the reference `DriverValue` enum (GK6X/KeyValues.cs).
  it('encodes keys as 0x02 00 usage modifiers', () => {
    expect(encode({ kind: 'key', code: 'a' })).toBe(0x02000400)
    expect(encode({ kind: 'key', code: 'escape' })).toBe(0x02002900)
    expect(encode({ kind: 'key', code: 'space' })).toBe(0x02002c00)
    expect(encode({ kind: 'key', code: 'enter' })).toBe(0x02002800)
    expect(encode({ kind: 'key', code: 'menu' })).toBe(0x02006500)
    expect(encode({ kind: 'key', code: 'f13' })).toBe(0x02006800)
    expect(encode({ kind: 'key', code: 'arrowup' })).toBe(0x02005200)
    expect(encode({ kind: 'key', code: 'arrowleft' })).toBe(0x02005000)
    expect(encode({ kind: 'key', code: 'arrowdown' })).toBe(0x02005100)
    expect(encode({ kind: 'key', code: 'arrowright' })).toBe(0x02004f00)
    expect(encode({ kind: 'key', code: 'delete' })).toBe(0x02004c00)
    expect(encode({ kind: 'key', code: 'digit0' })).toBe(0x02002700)
  })

  it('ORs modifiers into the low byte', () => {
    expect(encode({ kind: 'key', code: 'c', modifiers: ['ctrl'] })).toBe(0x02000601) // "Copy"
    expect(encode({ kind: 'key', code: 'v', modifiers: ['ctrl'] })).toBe(0x02001901) // "Paste"
    expect(encode({ kind: 'key', code: 'a', modifiers: ['ctrl', 'shift', 'alt', 'gui'] })).toBe(0x0200040f)
  })

  it('encodes modifier keys, disabled, none, consumer, macro and layer values', () => {
    expect(encode({ kind: 'key', code: 'lctrl' })).toBe(0x02000001)
    expect(encode({ kind: 'key', code: 'lshift' })).toBe(0x02000002)
    expect(encode({ kind: 'key', code: 'lalt' })).toBe(0x02000004)
    expect(encode({ kind: 'key', code: 'lwin' })).toBe(0x02000008)
    expect(encode({ kind: 'key', code: 'rctrl' })).toBe(0x02000010)
    expect(encode({ kind: 'key', code: 'rshift' })).toBe(0x02000020)
    expect(encode({ kind: 'key', code: 'ralt' })).toBe(0x02000040)
    expect(encode({ kind: 'key', code: 'rwin' })).toBe(0x02000080)
    expect(encode({ kind: 'key', code: 'disabled' })).toBe(DISABLED_KEY_VALUE)
    expect(encode({ kind: 'none' })).toBe(UNUSED_KEY_VALUE)
    expect(encode({ kind: 'key', code: 'volumeup' })).toBe(0x030000e9)
    expect(encode({ kind: 'key', code: 'volumemute' })).toBe(0x030000e2)
    expect(encode({ kind: 'key', code: 'launchmediaplayer' })).toBe(0x03000183)
    expect(encode({ kind: 'key', code: 'browserhome' })).toBe(0x03000223)
    expect(encode({ kind: 'macro', macroId: 'second' })).toBe(0x0a010003)
    expect(encode({ kind: 'layer', layer: 'base' })).toBe(0x0a070001)
    expect(encode({ kind: 'layer', layer: 'fn1' })).toBe(0x0a070002)
    expect(encode({ kind: 'layer', layer: 'fn3' })).toBe(0x0a070004)
  })

  it('refuses what has no key value', () => {
    expect(() => encode({ kind: 'key', code: 'fn' })).toThrow(UnencodableAssignmentError)
    expect(() => encode({ kind: 'macro', macroId: 'missing' })).toThrow(/Unknown macro/)
    expect(() => encode({ kind: 'key', code: 'volumeup', modifiers: ['ctrl'] })).toThrow(/Modifiers/)
    expect(() => encode({ kind: 'key', code: 'nope' })).toThrow(/Unknown key code/)
  })

  it('decodes every encodable key code back to itself', () => {
    for (const code of KEY_CODES) {
      if (code === 'fn') continue
      const assignment: KeyAssignment = { kind: 'key', code }
      expect(driverValueToAssignment(encode(assignment), decodeContext), code).toEqual(assignment)
    }
  })

  it('decodes modifier combinations, macros and layers', () => {
    const modifiers: Modifier[] = ['ctrl', 'alt']
    expect(driverValueToAssignment(encode({ kind: 'key', code: 'c', modifiers }), decodeContext)).toEqual({
      kind: 'key',
      code: 'c',
      modifiers,
    })
    expect(driverValueToAssignment(0x0a010003, decodeContext)).toEqual({ kind: 'macro', macroId: 'second' })
    expect(driverValueToAssignment(0x0a070003, decodeContext)).toEqual({ kind: 'layer', layer: 'fn2' })
    expect(driverValueToAssignment(UNUSED_KEY_VALUE, decodeContext)).toEqual({ kind: 'none' })
  })

  it('returns undefined for values the model cannot express', () => {
    expect(driverValueToAssignment(0x01010001, decodeContext)).toBeUndefined() // mouse left click
    expect(driverValueToAssignment(0x09020001, decodeContext)).toBeUndefined() // brightness up
    expect(driverValueToAssignment(0x02000430, decodeContext)).toBeUndefined() // right-hand modifiers on a key
    expect(driverValueToAssignment(0x02000003, decodeContext)).toBeUndefined() // two modifier bits, no key
    expect(driverValueToAssignment(0x0a010009, decodeContext)).toBeUndefined() // unknown macro index
    expect(driverValueToAssignment(0x0a070009, decodeContext)).toBeUndefined() // unknown layer
  })

  it('respects custom layer targets', () => {
    const layerTargets = { ...DEFAULT_LAYER_TARGETS, fn2: { layer: 5, fn: false } } as const
    expect(assignmentToDriverValue({ kind: 'layer', layer: 'fn2' }, { macroIndex: () => undefined, layerTargets })).toBe(0x0a070005)
  })
})
