import { describe, expect, it } from 'vitest'
import { crc16ccitt } from '../src/protocol/crc16.js'
import { getInfoFromLEBuffer, getLEBufferFromInfo } from '../src/protocol/le.js'
import { buildPacket, parsePacket, readU32LE } from '../src/protocol/packet.js'

describe('CRC-16/CCITT-FALSE', () => {
  it('matches the standard check value', () => {
    const input = new TextEncoder().encode('123456789')
    expect(crc16ccitt(input)).toBe(0x29b1)
  })
})

describe('64-byte packet codec', () => {
  it('round-trips command, header and body', () => {
    const raw = buildPacket({
      command: 0x01,
      subCommand: 0x08,
      header: 0x12345678,
      body: Uint8Array.from([1, 2, 3, 4]),
    })

    expect(raw).toHaveLength(64)
    expect(raw[0]).toBe(0x01)
    expect(raw[1]).toBe(0x08)
    expect(readU32LE(raw, 2)).toBe(0x12345678)
    expect(raw.slice(8, 12)).toEqual(Uint8Array.from([1, 2, 3, 4]))

    const parsed = parsePacket(raw, true)
    expect(parsed.command).toBe(0x01)
    expect(parsed.subCommand).toBe(0x08)
    expect(parsed.header).toBe(0x12345678)
    expect(parsed.body.slice(0, 4)).toEqual(Uint8Array.from([1, 2, 3, 4]))
  })

  it('rejects an invalid CRC', () => {
    const raw = buildPacket({ command: 0x0c })
    raw[20] = 0xff
    expect(() => parsePacket(raw, true)).toThrow(/CRC mismatch/)
  })
})

describe('LE container', () => {
  it('round-trips a light profile', () => {
    const body = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1])
    const encoded = getLEBufferFromInfo({
      header: { typeName: 'LIGHT', time: 1234567890 },
      body,
    })

    const decoded = getInfoFromLEBuffer(encoded)
    expect(decoded.header.typeName).toBe('LIGHT')
    expect(decoded.header.size).toBe(body.length)
    expect(decoded.body).toEqual(body)
  })

  it('rejects a corrupted body', () => {
    const encoded = getLEBufferFromInfo({
      header: { typeName: 'LIGHT' },
      body: Uint8Array.from([1, 2, 3]),
    })
    const last = encoded.length - 1
    encoded[last] = (encoded[last] ?? 0) ^ 0xff
    expect(() => getInfoFromLEBuffer(encoded)).toThrow(/CRC mismatch/)
  })
})
