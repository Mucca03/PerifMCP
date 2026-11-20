import { readU16LE, readU32LE, type Packet } from './packet.js'

export const COMMAND = {
  info: 0x01,
  changeMode: 0x0b,
  ping: 0x0c,
  keyReport: 0x15,
  setKeyTable: 0x16,
  setLEConfig: 0x17,
  setLEDefine: 0x1a,
  cleanData: 0x21,
  writeKeyData: 0x22,
  writeModeLE: 0x24,
  writeMacro: 0x25,
  writeLightKey: 0x26,
  writeLightData: 0x27,
  writeFnData: 0x31,
  usbVid: 0x41,
} as const

export const INFO = {
  version: 0x01,
  deviceId: 0x02,
  modelId: 0x08,
  matrix: 0x09,
} as const

export interface VersionInfo {
  id: number
  version: number
}

export function decodeVersion(packet: Packet): VersionInfo {
  return {
    id: readU32LE(packet.raw, 8),
    version: readU16LE(packet.raw, 12),
  }
}

export function decodeDeviceId(packet: Packet): string {
  let value = 0n
  for (let index = 0; index < 6; index += 1) {
    value |= BigInt(packet.raw[8 + index] ?? 0) << BigInt(index * 8)
  }
  return value.toString(10)
}

export function decodeModelId(packet: Packet): number {
  return readU32LE(packet.raw, 8)
}

export function decodeMatrix(packet: Packet): { row: number; column: number } {
  return {
    column: packet.raw[8] ?? 0,
    row: packet.raw[9] ?? 0,
  }
}
