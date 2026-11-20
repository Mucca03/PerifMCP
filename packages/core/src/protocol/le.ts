import { crc16ccitt } from './crc16.js'
import { readU32LE, writeU32LE } from './packet.js'

export const LE_MAGIC = 0x434d4631
export const LE_TYPES = ['_', 'PROFILE', 'LIGHT', 'STATASTIC', 'APPCONF', 'MACRO'] as const

export type LEType = (typeof LE_TYPES)[number]

export interface LEHeader {
  magic: number
  hcrc: number
  time: number
  size: number
  dcrc: number
  typeId: number
  typeName: string
}

export interface LEInfo {
  header: LEHeader
  body: Uint8Array
}

export interface LEInfoInput {
  header: {
    typeId?: number
    typeName?: string
    time?: number
  }
  body: Uint8Array
}

const HEADER_SIZE = 32
const TYPE_NAME_OFFSET = 24
const TYPE_NAME_SIZE = 8

function latin1ToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff
  }
  return bytes
}

function bytesToLatin1(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) {
    value += String.fromCharCode(byte)
  }
  return value
}

function writeLatin1(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = latin1ToBytes(value).slice(0, length)
  target.set(bytes, offset)
}

function readTypeName(header: Uint8Array): string {
  const raw = header.slice(TYPE_NAME_OFFSET, TYPE_NAME_OFFSET + TYPE_NAME_SIZE)
  const zero = raw.indexOf(0)
  return bytesToLatin1(zero === -1 ? raw : raw.slice(0, zero))
}

function getInitCRC(typeId: number, typeName: string): number {
  const type = latin1ToBytes(LE_TYPES[typeId] ?? '')
  const name = new Uint8Array(TYPE_NAME_SIZE)
  writeLatin1(name, 0, TYPE_NAME_SIZE, typeName)
  return crc16ccitt(name, crc16ccitt(type))
}

function headerToObject(header: Uint8Array): LEHeader {
  return {
    magic: readU32LE(header, 0),
    hcrc: readU32LE(header, 4),
    time: readU32LE(header, 8),
    size: readU32LE(header, 12),
    dcrc: readU32LE(header, 16),
    typeId: header[20] ?? 0,
    typeName: readTypeName(header),
  }
}

function headerToBuffer(header: LEHeader): Uint8Array {
  const buffer = new Uint8Array(HEADER_SIZE)
  writeU32LE(buffer, 0, LE_MAGIC)
  writeU32LE(buffer, 4, header.hcrc)
  writeU32LE(buffer, 8, header.time)
  writeU32LE(buffer, 12, header.size)
  writeU32LE(buffer, 16, header.dcrc)
  buffer[20] = header.typeId & 0xff
  writeLatin1(buffer, TYPE_NAME_OFFSET, TYPE_NAME_SIZE, header.typeName)
  return buffer
}

function decodedBody(header: LEHeader, encoded: Uint8Array): Uint8Array {
  const body = encoded.slice()
  let key = getInitCRC(header.typeId, header.typeName)
  let dataCrc = 0xffff

  for (let index = 0; index < body.length; index += 1) {
    body[index] = (body[index] ?? 0) ^ (key & 0xff)
    const byte = body.subarray(index, index + 1)
    key = crc16ccitt(byte, key)
    dataCrc = crc16ccitt(byte, dataCrc)
  }

  return body
}

function encodedBody(header: LEHeader, body: Uint8Array): Uint8Array {
  const encoded = new Uint8Array(body.length)
  let key = getInitCRC(header.typeId, header.typeName)

  for (let index = 0; index < body.length; index += 1) {
    const byte = body[index] ?? 0
    encoded[index] = byte ^ (key & 0xff)
    key = crc16ccitt(body.subarray(index, index + 1), key)
  }

  return encoded
}

function resolveType(input: LEInfoInput): { typeId: number; typeName: string } {
  let typeName = input.header.typeName
  let typeId = input.header.typeId

  if (typeName === undefined && typeId === undefined) {
    return { typeId: 2, typeName: 'LIGHT' }
  }
  if (typeId === undefined) {
    const index = LE_TYPES.indexOf(typeName as LEType)
    if (index < 0) {
      throw new Error(`Unknown LE type name: ${typeName}`)
    }
    typeId = index
  }
  if (typeName === undefined) {
    typeName = LE_TYPES[typeId]
    if (typeName === undefined) {
      throw new Error(`Unknown LE type id: ${typeId}`)
    }
  }

  return { typeId, typeName }
}

export function getInfoFromLEBuffer(buffer: Uint8Array): LEInfo {
  if (buffer.length < HEADER_SIZE) {
    throw new Error('LE buffer is smaller than its 32-byte header')
  }

  const headerBytes = buffer.slice(0, HEADER_SIZE)
  const header = headerToObject(headerBytes)
  const bodyBytes = buffer.slice(HEADER_SIZE)

  if (header.magic !== LE_MAGIC) {
    throw new Error('Invalid LE magic number')
  }
  if (header.size !== bodyBytes.length) {
    throw new Error(`LE data size mismatch: header=${header.size}, body=${bodyBytes.length}`)
  }

  const headerForCrc = headerToBuffer({ ...header, hcrc: 0 })
  if (crc16ccitt(headerForCrc) !== header.hcrc) {
    throw new Error('LE header CRC mismatch')
  }

  const body = decodedBody(header, bodyBytes)
  if (crc16ccitt(body) !== header.dcrc) {
    throw new Error('LE data CRC mismatch')
  }

  return { header, body }
}

export function getLEBufferFromInfo(input: LEInfoInput): Uint8Array {
  const { typeId, typeName } = resolveType(input)
  const body = input.body.slice()
  const info: LEHeader = {
    magic: LE_MAGIC,
    hcrc: 0,
    time: input.header.time ?? Math.round(Date.now() / 1000),
    size: body.length,
    dcrc: crc16ccitt(body),
    typeId,
    typeName,
  }

  info.hcrc = crc16ccitt(headerToBuffer(info))
  const encoded = encodedBody(info, body)
  const output = new Uint8Array(HEADER_SIZE + encoded.length)
  output.set(headerToBuffer(info), 0)
  output.set(encoded, HEADER_SIZE)
  return output
}
