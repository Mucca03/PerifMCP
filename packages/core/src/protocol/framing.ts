/**
 * Chunked writes: how a payload larger than one packet is split into 64-byte reports.
 *
 * Source: GK6X/KeyboardDevice.cs `WritePacket` (framing) and `SetKeys`, `SetMacros`, `SetLighting`
 * (reset before write), GK6X/OpCodes.cs (`KeyboardLayer`, `KeyboardLayerDataType`),
 * GK6X/CommandLogger.cs `BufferedPacket.TryGetBufferedInfo` (decoder side).
 *
 * Packet layout used by every buffered write (bytes 0-7 are the header, 56 payload bytes follow):
 *
 *   0      command (0x22, 0x25, 0x26, 0x27, 0x31)
 *   1      sub-command = device layer (1 = base, 2..4 = layer 1..3, 5 = driver)
 *   2-3    u16 offset of this chunk in the payload (only when more than one packet is needed)
 *   4      u8 length of this chunk (0x22, 0x25, 0x26, 0x31) ...
 *   5      ... or here (0x27)
 *   6-7    CRC-16/CCITT-FALSE of the 64 bytes with these two bytes zeroed
 *   8-63   payload chunk, zero padded
 *
 * Quirks kept from the reference (they are what the firmware has been seen to accept):
 * - A payload that fits in one packet (shorter than 56 bytes) is sent without offset and length (both 0).
 * - The packet count is `floor(length / 56) + 1`, so a payload whose length is an exact multiple of 56
 *   ends with an extra packet that has length 0.
 * - The reference also stores `offset >> 16` at byte 5 for 0x27, but the length byte overwrites it.
 *   Offsets are therefore limited to 16 bits here.
 */
import { BODY_SIZE, buildPacket, parsePacket, readU16LE } from './packet.js'

/** 0x38 payload bytes per packet. */
export const CHUNK_SIZE = BODY_SIZE

/** `KeyboardLayer` in the reference. The sub-command of every layer-addressed command. */
export const DEVICE_LAYER = {
  base: 1,
  layer1: 2,
  layer2: 3,
  layer3: 4,
  driver: 5,
} as const

export type DeviceLayer = (typeof DEVICE_LAYER)[keyof typeof DEVICE_LAYER]

/** `KeyboardLayerDataType` in the reference: the data type byte of command 0x21. */
export const DATA_TYPE = {
  keySet: 1,
  /** Command 0x24, "LE data". Listed for completeness, no encoder here. */
  leData: 3,
  macros: 4,
  keyPressLightingEffect: 5,
  lighting: 6,
  fnKeySet: 7,
} as const

export type DataType = (typeof DATA_TYPE)[keyof typeof DATA_TYPE]

export const WRITE_COMMAND = {
  reset: 0x21,
  keySet: 0x22,
  macros: 0x25,
  keyPressLightingEffect: 0x26,
  lighting: 0x27,
  fnKeySet: 0x31,
  setLayer: 0x0b,
} as const

/** Byte (inside the packet) that carries the chunk length. The offset is always at bytes 2-3. */
const LENGTH_BYTE: Readonly<Record<number, 4 | 5>> = {
  [WRITE_COMMAND.keySet]: 4,
  [WRITE_COMMAND.macros]: 4,
  [WRITE_COMMAND.keyPressLightingEffect]: 4,
  [WRITE_COMMAND.fnKeySet]: 4,
  [WRITE_COMMAND.lighting]: 5,
}

export const BUFFERED_COMMANDS: readonly number[] = Object.keys(LENGTH_BYTE).map(Number)

/** Command 0x21: clears one data type of one layer. No payload. */
export function buildResetPacket(layer: DeviceLayer, dataType: DataType): Uint8Array {
  return buildPacket({ command: WRITE_COMMAND.reset, subCommand: layer, header: dataType })
}

/** Command 0x0B: sets the active layer. The reference calls it with the base layer to refresh the keyboard. */
export function buildSetLayerPacket(layer: DeviceLayer): Uint8Array {
  return buildPacket({ command: WRITE_COMMAND.setLayer, subCommand: layer })
}

/** Splits `payload` into the packets for a buffered write command. Pure, never sends. */
export function buildBufferedWrite(command: number, layer: DeviceLayer, payload: Uint8Array): Uint8Array[] {
  const lengthByte = LENGTH_BYTE[command]
  if (lengthByte === undefined) {
    throw new RangeError(`0x${command.toString(16)} is not a buffered write command`)
  }
  if (payload.length > 0xffff) {
    throw new RangeError(`Payload of ${payload.length} bytes does not fit a 16-bit offset`)
  }

  const count = Math.floor(payload.length / CHUNK_SIZE) + 1
  const packets: Uint8Array[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = index * CHUNK_SIZE
    const chunk = payload.subarray(offset, Math.min(offset + CHUNK_SIZE, payload.length))
    let header = 0
    if (count > 1) {
      header = (offset & 0xffff) | (chunk.length << (lengthByte === 4 ? 16 : 24))
      header >>>= 0
    }
    packets.push(buildPacket({ command, subCommand: layer, header, body: chunk }))
  }
  return packets
}

export interface ReassembledWrite {
  command: number
  layer: number
  /**
   * The payload. For a single-packet write the length is not on the wire, so this is the whole
   * 56-byte body, zero padded. Decoders must not rely on its exact length in that case.
   */
  payload: Uint8Array
  packetCount: number
}

/** Inverse of `buildBufferedWrite`. Validates CRC, command, layer, offsets and lengths. */
export function reassembleBufferedWrite(packets: readonly Uint8Array[]): ReassembledWrite {
  const first = packets[0]
  if (first === undefined) throw new RangeError('No packets')
  const head = parsePacket(first, true)
  const lengthByte = LENGTH_BYTE[head.command]
  if (lengthByte === undefined) {
    throw new RangeError(`0x${head.command.toString(16)} is not a buffered write command`)
  }

  if (packets.length === 1) {
    return { command: head.command, layer: head.subCommand, payload: head.body.slice(), packetCount: 1 }
  }

  const chunks: Uint8Array[] = []
  let expectedOffset = 0
  for (const raw of packets) {
    const packet = parsePacket(raw, true)
    if (packet.command !== head.command || packet.subCommand !== head.subCommand) {
      throw new Error('Packets of one write must share command and layer')
    }
    const offset = readU16LE(packet.raw, 2)
    const length = packet.raw[lengthByte] ?? 0
    if (offset !== expectedOffset) throw new Error(`Chunk offset ${offset}, expected ${expectedOffset}`)
    if (length > CHUNK_SIZE) throw new Error(`Chunk length ${length} exceeds ${CHUNK_SIZE}`)
    chunks.push(packet.body.slice(0, length))
    expectedOffset += length
  }

  const payload = new Uint8Array(expectedOffset)
  let cursor = 0
  for (const chunk of chunks) {
    payload.set(chunk, cursor)
    cursor += chunk.length
  }
  return { command: head.command, layer: head.subCommand, payload, packetCount: packets.length }
}
