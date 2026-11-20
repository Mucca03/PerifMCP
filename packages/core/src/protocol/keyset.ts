/**
 * Key sets: command 0x22 (normal table) and 0x31 (Fn table).
 *
 * Source: GK6X/KeyboardDevice.cs `SetKeys`, GK6X/Program.cs (`map` command: the value array has
 * `MaxLogicCode` entries, all `UnusedKeyValue` unless mapped), GK6X/KeyboardState.cs
 * (`MaxLogicCode = bufferSizeA * bufferSizeB`, `KeySet` indexed by logic code).
 *
 * The payload is `logicSize` little-endian u32 values, one per logic code. The mapping from key id to
 * logic code (and to the lighting location code) is model data. It comes from the key matrix reported by
 * the keyboard and from per-model files that are not part of this repository, so callers supply it as
 * a `KeyIndexMap`. Nothing here guesses it.
 */
import type { KeyAssignment } from '../types.js'
import {
  UNUSED_KEY_VALUE,
  UnencodableAssignmentError,
  assignmentToDriverValue,
  driverValueToAssignment,
  type DriverValueContext,
  type DriverValueDecodeContext,
} from './driver-value.js'
import {
  DATA_TYPE,
  WRITE_COMMAND,
  buildBufferedWrite,
  buildResetPacket,
  type DeviceLayer,
} from './framing.js'
import { readU32LE, writeU32LE } from './packet.js'

export interface KeyIndexMap {
  /** key id -> logic code, the index into a key set. */
  logic: Readonly<Record<string, number>>
  /** key id -> location code, the index into lighting data. */
  location: Readonly<Record<string, number>>
  /** Number of entries in a key set (`bufferSizeA * bufferSizeB` from `Gk6xClient.matrix()`). */
  logicSize: number
}

export class UnmappedKeyError extends Error {
  constructor(readonly keyIds: string[]) {
    super(`No logic code for key(s): ${keyIds.join(', ')}`)
    this.name = 'UnmappedKeyError'
  }
}

export function validateKeyIndexMap(map: KeyIndexMap): string[] {
  const errors: string[] = []
  if (!Number.isInteger(map.logicSize) || map.logicSize <= 0 || map.logicSize * 4 > 0xffff) {
    errors.push('logicSize must be a positive integer whose key set fits a 16-bit offset')
  }
  const seen = new Map<number, string>()
  for (const [keyId, index] of Object.entries(map.logic)) {
    if (!Number.isInteger(index) || index < 0 || index >= map.logicSize) {
      errors.push(`logic code of ${keyId} is out of range: ${index}`)
    } else if (seen.has(index)) {
      errors.push(`logic code ${index} is used by ${seen.get(index)} and ${keyId}`)
    } else {
      seen.set(index, keyId)
    }
  }
  return errors
}

/**
 * Builds the value array of one key table. Keys without an assignment (or with `none`) keep the firmware
 * default (`UNUSED_KEY_VALUE`). The Fn key on the Fn key itself is left at the default too, because the
 * reference states it cannot be reprogrammed.
 */
export function encodeKeySetValues(
  assignments: Readonly<Record<string, KeyAssignment>>,
  map: KeyIndexMap,
  context: DriverValueContext,
): number[] {
  const values = new Array<number>(map.logicSize).fill(UNUSED_KEY_VALUE)
  const unmapped: string[] = []

  for (const [keyId, assignment] of Object.entries(assignments)) {
    if (assignment.kind === 'none') continue
    if (keyId === 'fn') {
      // The reference gives the Fn key no logic code (-1) and no key value.
      if (assignment.kind === 'key' && assignment.code === 'fn') continue
      throw new UnencodableAssignmentError('The Fn key cannot be reprogrammed')
    }
    const index = map.logic[keyId]
    if (index === undefined) {
      unmapped.push(keyId)
      continue
    }
    values[index] = assignmentToDriverValue(assignment, context)
  }

  if (unmapped.length > 0) throw new UnmappedKeyError(unmapped.sort())
  return values
}

export interface DecodedKeySet {
  assignments: Record<string, KeyAssignment>
  /** Values with no semantic equivalent, by key id. */
  unknown: Record<string, number>
  /** Non-default values at logic codes that map to no key, by logic code. */
  unmappedIndices: Record<number, number>
}

export function decodeKeySetValues(
  values: readonly number[],
  map: KeyIndexMap,
  context: DriverValueDecodeContext,
): DecodedKeySet {
  const keyIdByIndex = new Map(Object.entries(map.logic).map(([keyId, index]) => [index, keyId]))
  const result: DecodedKeySet = { assignments: {}, unknown: {}, unmappedIndices: {} }

  values.forEach((value, index) => {
    const keyId = keyIdByIndex.get(index)
    if (keyId === undefined) {
      if (value >>> 0 !== UNUSED_KEY_VALUE) result.unmappedIndices[index] = value >>> 0
      return
    }
    const assignment = driverValueToAssignment(value, context)
    if (assignment === undefined) result.unknown[keyId] = value >>> 0
    else if (assignment.kind !== 'none') result.assignments[keyId] = assignment
  })
  return result
}

export function keySetPayload(values: readonly number[]): Uint8Array {
  const payload = new Uint8Array(values.length * 4)
  values.forEach((value, index) => writeU32LE(payload, index * 4, value))
  return payload
}

export function keySetValuesFromPayload(payload: Uint8Array, logicSize: number): number[] {
  if (payload.length < logicSize * 4) {
    throw new RangeError(`Key set payload has ${payload.length} bytes, expected ${logicSize * 4}`)
  }
  return Array.from({ length: logicSize }, (_, index) => readU32LE(payload, index * 4))
}

/** Reset (0x21) then write (0x22, or 0x31 when `fn`). Same order as `KeyboardDevice.SetKeys`. */
export function buildKeySetWrite(layer: DeviceLayer, values: readonly number[], fn: boolean): Uint8Array[] {
  return [
    buildResetPacket(layer, fn ? DATA_TYPE.fnKeySet : DATA_TYPE.keySet),
    ...buildBufferedWrite(fn ? WRITE_COMMAND.fnKeySet : WRITE_COMMAND.keySet, layer, keySetPayload(values)),
  ]
}
