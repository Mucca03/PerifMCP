/**
 * Golden bytes. The expected values come from `test/golden/gen_golden.py`, an independent
 * implementation of the documented formats (it shares no code with the encoders). To regenerate: run the script.
 */
import { describe, expect, it } from 'vitest'
import {
  DATA_TYPE,
  DEVICE_LAYER,
  buildBufferedWrite,
  buildKeyPressEffectWrite,
  buildKeySetWrite,
  buildLightingWrite,
  buildMacroWrite,
  buildResetPacket,
  buildSetLayerPacket,
  createDefaultConfig,
  decodeKeyPressEffectPayload,
  decodeLightingPayload,
  decodeMacroPayload,
  decodeMacros,
  encodeKeyPressEffectPayload,
  encodeLightingPayload,
  encodeMacroPayload,
  getInfoFromLEBuffer,
  getLEBufferFromInfo,
  keySetValuesFromPayload,
  lightingToEffects,
  reassembleBufferedWrite,
  sha256,
  toHex,
  type KeyIndexMap,
  type LightingEffectRecord,
  type Macro,
} from '../src/index.js'
import { syntheticMap } from './helpers/map.js'

const digest = (packets: Uint8Array[]): string => {
  const all = new Uint8Array(packets.length * 64)
  packets.forEach((packet, index) => all.set(packet, index * 64))
  return toHex(sha256(all))
}

describe('golden: single commands', () => {
  it('reset (0x21), layer 1, data type 4 (macros)', () => {
    const packet = buildResetPacket(DEVICE_LAYER.base, DATA_TYPE.macros)
    expect(toHex(packet)).toBe(
      '2101040000003f8d' + '00'.repeat(56),
    )
  })

  it('set layer (0x0B), base', () => {
    expect(toHex(buildSetLayerPacket(DEVICE_LAYER.base))).toBe('0b0100000000a725' + '00'.repeat(56))
  })
})

describe('golden: key tables (0x22, 0x31)', () => {
  const values = [0x02000400, 0x02002900, 0xffffffff, 0x0a010000]

  it('writes a short table in one packet without offset and length', () => {
    const packets = buildKeySetWrite(DEVICE_LAYER.base, values, false)
    expect(packets).toHaveLength(2)
    expect(toHex(packets[0] as Uint8Array)).toBe('210101000000b209' + '00'.repeat(56))
    expect(toHex(packets[1] as Uint8Array)).toBe(
      '220100000000295e' + '0004000200290002ffffffff0000010a' + '00'.repeat(40),
    )
  })

  it('writes the Fn table with 0x31 to the requested layer', () => {
    const packets = buildKeySetWrite(DEVICE_LAYER.layer1, values, true)
    expect(toHex(packets[0] as Uint8Array)).toBe('2102070000005f35' + '00'.repeat(56))
    expect(toHex(packets[1] as Uint8Array)).toBe(
      '310200000000772c' + '0004000200290002ffffffff0000010a' + '00'.repeat(40),
    )
  })

  it('splits 120 bytes into 56 + 56 + 8 with offset at bytes 2-3 and length at byte 4', () => {
    const payload = new Uint8Array(120)
    const view = new DataView(payload.buffer)
    for (let i = 0; i < 30; i += 1) view.setUint32(i * 4, 0x02000400 + (i << 8), true)

    const packets = buildBufferedWrite(0x22, DEVICE_LAYER.base, payload)
    expect(packets).toHaveLength(3)
    expect(toHex((packets[0] as Uint8Array).subarray(0, 20))).toBe('220100003800f91a000400020005000200060002')
    expect(toHex((packets[1] as Uint8Array).subarray(0, 8))).toBe('220138003800b58f')
    expect(toHex((packets[2] as Uint8Array).subarray(0, 16))).toBe('220170000800dc010020000200210002')
    expect(digest(packets)).toBe('391d4eecc1c1eaa6da1f69e5e68febfacd661ad3a322f3d60df9f5678f2fd8c3')

    const joined = reassembleBufferedWrite(packets)
    expect(joined.payload).toEqual(payload)
    expect(keySetValuesFromPayload(joined.payload, 30)[29]).toBe(0x02002100)
  })

  it('adds an empty trailing packet when the payload is an exact multiple of 56 bytes (reference quirk)', () => {
    const payload = Uint8Array.from({ length: 56 }, (_, index) => index)
    const packets = buildBufferedWrite(0x22, DEVICE_LAYER.base, payload)
    expect(packets).toHaveLength(2)
    expect(toHex((packets[0] as Uint8Array).subarray(0, 8))).toBe('220100003800f89e')
    expect(toHex(packets[1] as Uint8Array)).toBe('22013800000072a9' + '00'.repeat(56))
    expect(reassembleBufferedWrite(packets).payload).toEqual(payload)
  })

  it('rejects commands that are not buffered writes and oversized payloads', () => {
    expect(() => buildBufferedWrite(0x01, DEVICE_LAYER.base, new Uint8Array(4))).toThrow(/not a buffered write/)
    expect(() => buildBufferedWrite(0x22, DEVICE_LAYER.base, new Uint8Array(0x10000))).toThrow(/16-bit offset/)
  })
})

describe('golden: macros (0x25)', () => {
  const copy: Macro = {
    id: 'copy',
    name: 'copy',
    repeat: 2,
    steps: [
      { type: 'key', code: 'c', modifiers: ['ctrl'] },
      { type: 'delay', ms: 100 },
    ],
  }
  const letterA: Macro = { id: 'a', name: 'a', steps: [{ type: 'key', code: 'a' }] }

  it('encodes ctrl+c with a trailing delay and repeat 2', () => {
    const payload = encodeMacroPayload([copy])
    expect(payload).toHaveLength(512)
    expect(toHex(payload.subarray(0, 40))).toBe(
      'aa55c141080001020001010100000003060001010000000300010201000000030600020164000003',
    )
    expect(toHex(sha256(payload))).toBe('f01348bfb2442b1529d605ef35153220f7c02e4478e2a8e3a31eaeed3b0cad90')
  })

  it('encodes a record without a trailing delay as an odd int count', () => {
    // Second record of the table, so its macro index is 1.
    const record = encodeMacroPayload([copy, letterA]).subarray(512)
    expect(record).toHaveLength(512)
    expect(toHex(record.subarray(0, 24))).toBe('aa552b5f03010101' + '0400010100000003' + '0400020100000000')
    expect(toHex(sha256(record))).toBe('fedc21292bfd718ba5ac238b54628f7195fa514cbfe76f41bd84eb0a82aa0c8c')
  })

  it('writes two records with a reset, 512 bytes apart', () => {
    const packets = buildMacroWrite(DEVICE_LAYER.base, [copy, letterA])
    expect(packets).toHaveLength(1 + 19)
    expect(packets[0]?.[2]).toBe(DATA_TYPE.macros)
    expect(digest(packets.slice(1))).toBe('6146f31c6d9c76df824fa01b0c38e180a1ea4ed3a8443bca7e75461c43c2e760')
    expect(toHex((packets[1] as Uint8Array).subarray(0, 32))).toBe(
      '2501000038008ee4' + 'aa55c14108000102' + '0001010100000003' + '0600010100000003',
    )

    const records = decodeMacroPayload(reassembleBufferedWrite(packets.slice(1)).payload)
    expect(records.map((record) => [record.index, record.repeatCount, record.trailingDelay, record.actions.length])).toEqual([
      [0, 2, true, 4],
      [1, 1, false, 2],
    ])
  })

  it('round-trips semantic macros', () => {
    const decoded = decodeMacros(encodeMacroPayload([copy, letterA]), ['copy', 'a'])
    expect(decoded).toEqual([copy, letterA])
  })
})

describe('golden: lighting (0x27) and key press effects (0x26)', () => {
  it('encodes a static effect: table entry, RGBA order and 22 packets', () => {
    const effects: LightingEffectRecord[] = [
      {
        type: 'static',
        colors: { 0: { r: 255, g: 0, b: 0, a: 255 }, 5: { r: 10, g: 20, b: 30, a: 255 } },
      },
    ]
    const payload = encodeLightingPayload(effects)
    expect(payload).toHaveLength(1220)
    // entry 0: dataOffset 512, dataCount 1, no params
    expect(toHex(payload.subarray(0, 16))).toBe('00020000' + '01000000' + '00000000' + '00000000')
    // the other 31 entries are -1
    expect(toHex(payload.subarray(16, 32))).toBe('ff'.repeat(16))
    // record header: type 0, length 704, then slot 0 = red, slot 5 = (10,20,30,255)
    expect(toHex(payload.subarray(512, 520))).toBe('0000c002' + 'ff0000ff')
    expect(toHex(payload.subarray(516 + 20, 516 + 24))).toBe('0a141eff')

    const packets = buildLightingWrite(DEVICE_LAYER.base, effects)
    expect(packets).toHaveLength(1 + 22)
    expect(toHex((packets[1] as Uint8Array).subarray(0, 24))).toBe('270100000038dfb6' + '00020000010000000000000000000000')
    expect(digest(packets.slice(1))).toBe('ecc7193def781dfe961f4f518fc9f9cf7cffeeb88d7c4f8b011b07f0c550e120')
    expect(decodeLightingPayload(reassembleBufferedWrite(packets.slice(1)).payload)).toEqual(effects)
  })

  it('encodes a dynamic effect: one data record per displayed frame, then 32 byte params', () => {
    const effects: LightingEffectRecord[] = [
      {
        type: 'dynamic',
        frames: [{ count: 2, keys: [0, 9] }],
        params: [{ colorType: 2, keys: [0, 9], color: { r: 1, g: 2, b: 3, a: 255 }, value1: 5, value2: 7 }],
      },
    ]
    const payload = encodeLightingPayload(effects)
    expect(payload).toHaveLength(596)
    // dataOffset 512, dataCount 2 (frame count), paramOffset 564, paramCount 1
    expect(toHex(payload.subarray(0, 16))).toBe('00020000' + '02000000' + '34020000' + '01000000')
    expect(toHex(payload.subarray(512, 538))).toBe('0300160001020000000000000000000000000000000000000000')
    expect(toHex(payload.subarray(564, 596))).toBe('022001020000000000000000000000000000000000000000010203ff05000700')
    expect(toHex(sha256(payload))).toBe('c8b3beabe0784e6587fd8646ada22eb477b2b59d05f2cf161c8f94350493e7f1')
    expect(digest(buildLightingWrite(DEVICE_LAYER.base, effects).slice(1))).toBe(
      'b458e71afa38aed93062e4ef1ef26877571df021d882edfb1f86a831a552b4b3',
    )
    expect(decodeLightingPayload(payload)).toEqual(effects)
  })

  it('encodes breathing built from the semantic state like the independent generator does', () => {
    // Expected bytes and hashes from test/golden/gen_golden.py (case G2): one color on all 64 keys, speed 50.
    const map = syntheticMap()
    const lighting = { ...createDefaultConfig().lighting, enabled: true, effect: 'breathing' as const, color: { r: 134, g: 239, b: 172 }, brightness: 100, speed: 50 }
    const effects = lightingToEffects(lighting, map)
    const payload = encodeLightingPayload(effects)
    expect(payload).toHaveLength(570)
    // dataOffset 512, dataCount 1 (one frame record), paramOffset 538, paramCount 1
    expect(toHex(payload.subarray(0, 16))).toBe('00020000' + '01000000' + '1a020000' + '01000000')
    expect(toHex(payload.subarray(538, 570))).toBe('0220ffffffffffffffff000000000000000000000000000086efac0005000500')
    expect(toHex(sha256(payload))).toBe('5c21ad592489632599b8543002b1950008570f6043b9e78433d7e819c4f16e26')
    const packets = buildLightingWrite(DEVICE_LAYER.base, effects)
    expect(packets).toHaveLength(1 + 11)
    expect(digest(packets.slice(1))).toBe('6e70fe042e0ea7e5b14a0a4457b1d5d94ddaf197d48afe516f255ecda652a2c0')
    expect(decodeLightingPayload(reassembleBufferedWrite(packets.slice(1)).payload)).toEqual(effects)
  })

  it('writes key press effects, 0xFF meaning none', () => {
    const map: KeyIndexMap = { logic: { a: 1, b: 3 }, location: {}, logicSize: 5 }
    const payload = encodeKeyPressEffectPayload({ a: 3, b: 0 }, map)
    expect(toHex(payload)).toBe('ff03ff00ff')
    const packets = buildKeyPressEffectWrite(DEVICE_LAYER.base, payload)
    expect(packets[0]?.[2]).toBe(DATA_TYPE.keyPressLightingEffect)
    expect(toHex(packets[1] as Uint8Array)).toBe('2601000000008957' + 'ff03ff00ff' + '00'.repeat(51))
    expect(decodeKeyPressEffectPayload(payload, map)).toEqual({ a: 3, b: 0 })
  })
})

describe('golden: LE container', () => {
  // Source: GK6X/CMFile.cs Encrypt. Expected bytes from test/golden/gen_golden.py.
  it('encodes a LIGHT file', () => {
    const buffer = getLEBufferFromInfo({
      header: { typeName: 'LIGHT', time: 1700000000 },
      body: Uint8Array.from({ length: 10 }, (_, index) => index),
    })
    expect(toHex(buffer)).toBe('31464d43b377000000f153650a00000041c20000020000004c49474854000000dec4e963ae51bc849030')
    expect(getInfoFromLEBuffer(buffer).body).toEqual(Uint8Array.from({ length: 10 }, (_, index) => index))
  })

  it('encodes a MACRO file', () => {
    const buffer = getLEBufferFromInfo({ header: { typeId: 5, typeName: 'MACRO', time: 1700000000 }, body: new TextEncoder().encode('hello') })
    expect(toHex(buffer)).toBe('31464d434fae000000f15365050000006ed20000050000004d4143524f000000bbef83ba60')
    expect(new TextDecoder().decode(getInfoFromLEBuffer(buffer).body)).toBe('hello')
  })
})
