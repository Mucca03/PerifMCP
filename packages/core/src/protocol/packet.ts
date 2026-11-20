import { crc16ccitt } from './crc16.js'

export const PACKET_SIZE = 64
export const BODY_OFFSET = 8
export const BODY_SIZE = PACKET_SIZE - BODY_OFFSET

export interface Packet {
  command: number
  subCommand: number
  header: number
  crc: number
  body: Uint8Array
  raw: Uint8Array
}

export interface PacketInput {
  command: number
  subCommand?: number
  header?: number
  body?: Uint8Array
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be an integer between 0 and 255`)
  }
}

export function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

export function readU16LE(source: Uint8Array, offset: number): number {
  return (source[offset] ?? 0) | ((source[offset + 1] ?? 0) << 8)
}

export function writeU32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

export function readU32LE(source: Uint8Array, offset: number): number {
  return (
    ((source[offset] ?? 0) |
      ((source[offset + 1] ?? 0) << 8) |
      ((source[offset + 2] ?? 0) << 16) |
      ((source[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

export function buildPacket(input: PacketInput): Uint8Array {
  const packet = new Uint8Array(PACKET_SIZE)
  assertByte(input.command, 'command')
  assertByte(input.subCommand ?? 0, 'subCommand')

  const body = input.body ?? new Uint8Array(0)
  if (body.length > BODY_SIZE) {
    throw new RangeError(`body must be at most ${BODY_SIZE} bytes, got ${body.length}`)
  }

  packet[0] = input.command
  packet[1] = input.subCommand ?? 0
  writeU32LE(packet, 2, input.header ?? 0)
  packet.set(body, BODY_OFFSET)

  // Bytes 6-7 are zero while the CRC is calculated, then replaced by the CRC.
  writeU16LE(packet, 6, crc16ccitt(packet))
  return packet
}

export function parsePacket(raw: Uint8Array, verifyCrc = false): Packet {
  if (raw.length < PACKET_SIZE) {
    throw new RangeError(`expected a ${PACKET_SIZE}-byte packet, got ${raw.length}`)
  }

  const packet = raw.slice(0, PACKET_SIZE)
  const crc = readU16LE(packet, 6)
  if (verifyCrc) {
    const copy = packet.slice()
    writeU16LE(copy, 6, 0)
    const expected = crc16ccitt(copy)
    if (expected !== crc) {
      throw new Error(`CRC mismatch: expected 0x${expected.toString(16)}, got 0x${crc.toString(16)}`)
    }
  }

  return {
    command: packet[0] ?? 0,
    subCommand: packet[1] ?? 0,
    header: readU32LE(packet, 2),
    crc,
    body: packet.slice(BODY_OFFSET),
    raw: packet,
  }
}

export function packetBody(packet: Packet, length: number): Uint8Array {
  if (length < 0 || length > BODY_SIZE) {
    throw new RangeError(`body length must be between 0 and ${BODY_SIZE}`)
  }
  return packet.body.slice(0, length)
}
