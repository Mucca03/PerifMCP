import { describe, expect, it } from 'vitest'
import {
  DEVICE_LAYER,
  GIM_K64_LAYOUT,
  UNUSED_KEY_VALUE,
  UnencodableAssignmentError,
  UnmappedKeyError,
  buildKeySetWrite,
  createDefaultConfig,
  decodeKeySetValues,
  encodeKeySetValues,
  keySetPayload,
  keySetValuesFromPayload,
  reassembleBufferedWrite,
  validateKeyIndexMap,
  type KeyAssignment,
} from '../src/index.js'
import { syntheticMap } from './helpers/map.js'

const map = syntheticMap()
const noMacros = { macroIndex: () => undefined }
const noMacroIds = { macroId: () => undefined }

describe('key set values', () => {
  it('defaults every entry to the unused value', () => {
    const values = encodeKeySetValues({}, map, noMacros)
    expect(values).toHaveLength(64)
    expect(values.every((value) => value === UNUSED_KEY_VALUE)).toBe(true)
  })

  it('places each key at its logic code', () => {
    const values = encodeKeySetValues(
      {
        escape: { kind: 'key', code: 'a' },
        q: { kind: 'key', code: 'c', modifiers: ['ctrl'] },
        space: { kind: 'none' },
      },
      map,
      noMacros,
    )
    expect(values[map.logic.escape as number]).toBe(0x02000400)
    expect(values[map.logic.q as number]).toBe(0x02000601)
    expect(values[map.logic.space as number]).toBe(UNUSED_KEY_VALUE)
  })

  it('encodes the default config and decodes it back, minus the fn key', () => {
    const { base } = createDefaultConfig().layers
    const values = encodeKeySetValues(base, map, noMacros)
    const decoded = decodeKeySetValues(values, map, noMacroIds)

    const expected: Record<string, KeyAssignment> = { ...base }
    delete expected.fn
    expect(decoded.assignments).toEqual(expected)
    expect(decoded.unknown).toEqual({})
    expect(decoded.unmappedIndices).toEqual({})
    expect(Object.keys(decoded.assignments)).toHaveLength(GIM_K64_LAYOUT.keyCount - 1)
  })

  it('reports values it cannot express and values at unmapped indices', () => {
    const values = new Array<number>(64).fill(UNUSED_KEY_VALUE)
    values[map.logic.q as number] = 0x01010001
    // fn has a location code but no logic code in the synthetic map.
    const unmapped = map.location.fn as number
    values[unmapped] = 0x02000400
    const decoded = decodeKeySetValues(values, map, noMacroIds)
    expect(decoded.unknown).toEqual({ q: 0x01010001 })
    expect(decoded.unmappedIndices).toEqual({ [unmapped]: 0x02000400 })
  })

  it('fails on unmapped keys and on reprogramming fn', () => {
    expect(() => encodeKeySetValues({ nonexistent: { kind: 'key', code: 'a' } }, map, noMacros)).toThrow(UnmappedKeyError)
    expect(() => encodeKeySetValues({ fn: { kind: 'key', code: 'a' } }, map, noMacros)).toThrow(UnencodableAssignmentError)
    expect(() => encodeKeySetValues({ q: { kind: 'macro', macroId: 'x' } }, map, noMacros)).toThrow(/Unknown macro/)
  })

  it('writes the table little endian, 4 bytes per entry, and reads it back', () => {
    const values = encodeKeySetValues({ escape: { kind: 'key', code: 'a' } }, map, noMacros)
    const payload = keySetPayload(values)
    expect(payload).toHaveLength(256)
    expect(Array.from(payload.subarray(0, 4))).toEqual([0x00, 0x04, 0x00, 0x02])
    expect(keySetValuesFromPayload(payload, 64)).toEqual(values)

    const packets = buildKeySetWrite(DEVICE_LAYER.layer2, values, false)
    // reset + ceil-ish: 256 bytes -> floor(256 / 56) + 1 = 5 packets
    expect(packets).toHaveLength(1 + 5)
    expect(reassembleBufferedWrite(packets.slice(1)).payload).toEqual(payload)
    expect(packets.slice(1).every((packet) => packet[1] === DEVICE_LAYER.layer2)).toBe(true)
  })

  it('validates a key index map', () => {
    expect(validateKeyIndexMap(map)).toEqual([])
    expect(validateKeyIndexMap({ ...map, logicSize: 0 })).not.toEqual([])
    expect(validateKeyIndexMap({ ...map, logic: { a: 1, b: 1 } })).toHaveLength(1)
    expect(validateKeyIndexMap({ ...map, logic: { a: 64 } })).toHaveLength(1)
  })
})
