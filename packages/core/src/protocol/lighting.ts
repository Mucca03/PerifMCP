/**
 * Lighting data (command 0x27) and per-key press effects (command 0x26).
 *
 * Source: GK6X/KeyboardDevice.cs `SetLighting` (payload layout), GK6X/UserDataFile.cs `LightingEffect`
 * (`MaxEffects`, `NumStaticLightingBytes`, `TryParseColor` byte order), GK6X/Enums.cs
 * (`LightingEffectType`, `LightingEffectColorType`), GK6X/CommandLogger.cs `ProcessBufferedPacket`
 * (`LayerSetLightValues` decoder) and `ProcessKeyPressLightingEffect`, GK6X/KeyboardState.cs
 * (`KeyPressLightingEffect`: one byte per logic code, 0xFF = none).
 *
 * 0x27 payload (little endian):
 *
 *   0      32 table entries of 16 bytes: i32 dataOffset, i32 dataCount, i32 paramOffset, i32 paramCount
 *          (all four -1 for an unused entry). Offsets are from the start of the payload.
 *   512    for each effect in order, its data records, then its parameter records.
 *
 *   static effect  data: one record {u16 type = 0, u16 length = 704, 176 x RGBA}, no parameters (offset 0, count 0)
 *   dynamic effect data: one record per displayed frame {u16 type = 3, u16 length = 22, 22 byte key mask}
 *                  params: 32 byte records {u8 colorType, u8 32, 22 byte key mask, RGBA, u16 value1, u16 value2}
 *
 * A key mask is a bit set over lighting location codes, bit `k` of byte `k / 8` is `1 << (k % 8)`.
 * RGBA is four bytes in the order red, green, blue, alpha. Static colors use alpha 0xFF when lit.
 *
 * Dynamic effects are encoded from explicit raw records, and `breathing` is built from the semantic lighting
 * state with the reference conventions (`SetLighting`: breathing value1 = 100 / count, value2 = "StayCount").
 * The vendor's `.le` effect files (proprietary, not in this repository) are not used: the values below were
 * calibrated against their parameter ranges (breathing: count 20 and stay 5 in most of them, count 6 and
 * stay 25 in the fastest ones), and the effect itself is defined here.
 * unverified: what the firmware does with values outside those conventions.
 */
import type { LightingState, RGBColor } from '../types.js'
import { DATA_TYPE, WRITE_COMMAND, buildBufferedWrite, buildResetPacket, type DeviceLayer } from './framing.js'
import type { KeyIndexMap } from './keyset.js'
import { readU16LE, readU32LE, writeU16LE, writeU32LE } from './packet.js'

export const LIGHTING_MAX_EFFECTS = 32
export const LIGHTING_TABLE_ENTRY_SIZE = 16
export const LIGHTING_TABLE_SIZE = LIGHTING_MAX_EFFECTS * LIGHTING_TABLE_ENTRY_SIZE
/** Number of RGBA slots in a static record (704 bytes / 4). */
export const STATIC_LIGHTING_SLOTS = 176
export const STATIC_LIGHTING_BYTES = STATIC_LIGHTING_SLOTS * 4
export const KEY_MASK_BYTES = 22
export const LIGHTING_PARAM_SIZE = 32

export const LIGHTING_DATA_TYPE = { static: 0, dynamic: 3 } as const
export const LIGHTING_COLOR_TYPE = { monochrome: 0, rgb: 1, breathing: 2 } as const

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface StaticLightingEffect {
  type: 'static'
  /** Location code -> color. Codes not listed are written as 0 (unlit). */
  colors: Readonly<Record<number, Rgba>>
}

export interface DynamicLightingFrame {
  /** Number of ticks this frame is shown. Written as that many identical records. */
  count: number
  /** Location codes lit by the frame. */
  keys: readonly number[]
}

export interface DynamicLightingParam {
  colorType: number
  keys: readonly number[]
  color: Rgba
  /** The two u16 values exactly as written to the device. */
  value1: number
  value2: number
}

export interface DynamicLightingEffect {
  type: 'dynamic'
  frames: readonly DynamicLightingFrame[]
  params: readonly DynamicLightingParam[]
}

export type LightingEffectRecord = StaticLightingEffect | DynamicLightingEffect

export class UnsupportedLightingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedLightingError'
  }
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be an integer between 0 and 255`)
  }
}

function writeRgba(target: Uint8Array, offset: number, color: Rgba): void {
  assertByte(color.r, 'r')
  assertByte(color.g, 'g')
  assertByte(color.b, 'b')
  assertByte(color.a, 'a')
  target[offset] = color.r
  target[offset + 1] = color.g
  target[offset + 2] = color.b
  target[offset + 3] = color.a
}

function readRgba(source: Uint8Array, offset: number): Rgba {
  return {
    r: source[offset] ?? 0,
    g: source[offset + 1] ?? 0,
    b: source[offset + 2] ?? 0,
    a: source[offset + 3] ?? 0,
  }
}

function keyMask(keys: readonly number[]): Uint8Array {
  const mask = new Uint8Array(KEY_MASK_BYTES)
  for (const key of keys) {
    if (!Number.isInteger(key) || key < 0 || key >= KEY_MASK_BYTES * 8) {
      throw new RangeError(`Location code ${key} does not fit a ${KEY_MASK_BYTES * 8}-bit key mask`)
    }
    const index = key >> 3
    mask[index] = (mask[index] ?? 0) | (1 << (key & 7))
  }
  return mask
}

function maskKeys(mask: Uint8Array): number[] {
  const keys: number[] = []
  for (let key = 0; key < mask.length * 8; key += 1) {
    if (((mask[key >> 3] ?? 0) & (1 << (key & 7))) !== 0) keys.push(key)
  }
  return keys
}

function staticRecord(effect: StaticLightingEffect): Uint8Array {
  const record = new Uint8Array(4 + STATIC_LIGHTING_BYTES)
  writeU16LE(record, 0, LIGHTING_DATA_TYPE.static)
  writeU16LE(record, 2, STATIC_LIGHTING_BYTES)
  for (const [key, color] of Object.entries(effect.colors)) {
    const slot = Number(key)
    if (!Number.isInteger(slot) || slot < 0 || slot >= STATIC_LIGHTING_SLOTS) {
      throw new RangeError(`Location code ${key} is outside the ${STATIC_LIGHTING_SLOTS} static slots`)
    }
    writeRgba(record, 4 + slot * 4, color)
  }
  return record
}

export function encodeLightingPayload(effects: readonly LightingEffectRecord[]): Uint8Array {
  if (effects.length > LIGHTING_MAX_EFFECTS) {
    throw new RangeError(`At most ${LIGHTING_MAX_EFFECTS} lighting effects fit, got ${effects.length}`)
  }

  const table = new Uint8Array(LIGHTING_TABLE_SIZE).fill(0xff)
  const parts: Uint8Array[] = [table]
  let cursor = LIGHTING_TABLE_SIZE

  effects.forEach((effect, index) => {
    const entry = index * LIGHTING_TABLE_ENTRY_SIZE
    const dataOffset = cursor
    let dataCount = 0
    let paramOffset = 0
    let paramCount = 0

    if (effect.type === 'static') {
      const record = staticRecord(effect)
      parts.push(record)
      cursor += record.length
      dataCount = 1
    } else {
      for (const frame of effect.frames) {
        if (!Number.isInteger(frame.count) || frame.count < 1) throw new RangeError('Frame count must be at least 1')
        const mask = keyMask(frame.keys)
        for (let tick = 0; tick < frame.count; tick += 1) {
          const record = new Uint8Array(4 + KEY_MASK_BYTES)
          writeU16LE(record, 0, LIGHTING_DATA_TYPE.dynamic)
          writeU16LE(record, 2, KEY_MASK_BYTES)
          record.set(mask, 4)
          parts.push(record)
          cursor += record.length
          dataCount += 1
        }
      }
      paramOffset = cursor
      for (const param of effect.params) {
        assertByte(param.colorType, 'colorType')
        const record = new Uint8Array(LIGHTING_PARAM_SIZE)
        record[0] = param.colorType
        record[1] = LIGHTING_PARAM_SIZE
        record.set(keyMask(param.keys), 2)
        writeRgba(record, 24, param.color)
        writeU16LE(record, 28, param.value1)
        writeU16LE(record, 30, param.value2)
        parts.push(record)
        cursor += record.length
        paramCount += 1
      }
    }

    writeU32LE(table, entry, dataOffset)
    writeU32LE(table, entry + 4, dataCount)
    writeU32LE(table, entry + 8, paramOffset)
    writeU32LE(table, entry + 12, paramCount)
  })

  const payload = new Uint8Array(cursor)
  let position = 0
  for (const part of parts) {
    payload.set(part, position)
    position += part.length
  }
  return payload
}

/**
 * Decodes a payload made by `encodeLightingPayload`. Consecutive identical frame records are folded into
 * one frame with a count, so an input with two adjacent identical frames does not round-trip to itself
 * (it round-trips to the same bytes).
 */
export function decodeLightingPayload(payload: Uint8Array): LightingEffectRecord[] {
  if (payload.length < LIGHTING_TABLE_SIZE) throw new RangeError('Lighting payload is shorter than its table')
  const effects: LightingEffectRecord[] = []

  for (let index = 0; index < LIGHTING_MAX_EFFECTS; index += 1) {
    const entry = index * LIGHTING_TABLE_ENTRY_SIZE
    const dataOffset = readU32LE(payload, entry) | 0
    const dataCount = readU32LE(payload, entry + 4) | 0
    const paramOffset = readU32LE(payload, entry + 8) | 0
    const paramCount = readU32LE(payload, entry + 12) | 0
    if (dataOffset === -1 && dataCount === -1) continue
    if (dataCount <= 0) continue

    const type = readU16LE(payload, dataOffset)
    if (type === LIGHTING_DATA_TYPE.static) {
      const length = readU16LE(payload, dataOffset + 2)
      if (dataCount !== 1 || length !== STATIC_LIGHTING_BYTES) throw new RangeError('Unexpected static lighting record')
      const colors: Record<number, Rgba> = {}
      for (let slot = 0; slot < STATIC_LIGHTING_SLOTS; slot += 1) {
        const color = readRgba(payload, dataOffset + 4 + slot * 4)
        if (color.r !== 0 || color.g !== 0 || color.b !== 0 || color.a !== 0) colors[slot] = color
      }
      effects.push({ type: 'static', colors })
    } else if (type === LIGHTING_DATA_TYPE.dynamic) {
      const frames: DynamicLightingFrame[] = []
      for (let tick = 0; tick < dataCount; tick += 1) {
        const offset = dataOffset + tick * (4 + KEY_MASK_BYTES)
        if (readU16LE(payload, offset) !== LIGHTING_DATA_TYPE.dynamic || readU16LE(payload, offset + 2) !== KEY_MASK_BYTES) {
          throw new RangeError('Unexpected dynamic lighting record')
        }
        const keys = maskKeys(payload.subarray(offset + 4, offset + 4 + KEY_MASK_BYTES))
        const last = frames[frames.length - 1]
        if (last !== undefined && last.keys.length === keys.length && last.keys.every((key, i) => key === keys[i])) {
          frames[frames.length - 1] = { count: last.count + 1, keys: last.keys }
        } else {
          frames.push({ count: 1, keys })
        }
      }
      const params: DynamicLightingParam[] = []
      for (let i = 0; i < paramCount; i += 1) {
        const offset = paramOffset + i * LIGHTING_PARAM_SIZE
        params.push({
          colorType: payload[offset] ?? 0,
          keys: maskKeys(payload.subarray(offset + 2, offset + 2 + KEY_MASK_BYTES)),
          color: readRgba(payload, offset + 24),
          value1: readU16LE(payload, offset + 28),
          value2: readU16LE(payload, offset + 30),
        })
      }
      effects.push({ type: 'dynamic', frames, params })
    } else {
      throw new RangeError(`Unknown lighting data type ${type}`)
    }
  }
  return effects
}

/** Reset (0x21, data type 6) then write (0x27). Same order as `KeyboardDevice.SetLighting`. */
export function buildLightingWrite(layer: DeviceLayer, effects: readonly LightingEffectRecord[]): Uint8Array[] {
  return [
    buildResetPacket(layer, DATA_TYPE.lighting),
    ...buildBufferedWrite(WRITE_COMMAND.lighting, layer, encodeLightingPayload(effects)),
  ]
}

/** Only the reset (0x21, data type 6), the reference's "no lighting" path. No payload follows. */
export function buildLightingReset(layer: DeviceLayer): Uint8Array[] {
  return [buildResetPacket(layer, DATA_TYPE.lighting)]
}

// ---------------------------------------------------------------------------
// Semantic lighting -> static effect
// ---------------------------------------------------------------------------

function scale(color: RGBColor, brightness: number): Rgba {
  const factor = Math.min(100, Math.max(0, brightness)) / 100
  return {
    r: Math.round(color.r * factor),
    g: Math.round(color.g * factor),
    b: Math.round(color.b * factor),
    a: 0xff,
  }
}

/** Most distinct colors one breathing effect may use. unverified: the firmware limit is not documented. */
export const BREATHING_MAX_COLORS = 16
/** Ticks a breathing key stays lit at full brightness. The vendor's own effects mostly use 5. */
export const BREATHING_STAY = 5

/**
 * Converts a speed percentage to the two device values of a breathing parameter.
 *
 * The reference stores `value1 = 100 / count` and `value2 = stayCount`, where `count` is the length of the
 * ramp in ticks: the vendor's effects use 20 for a medium speed and 6 for the fastest. Speed 0 maps to a
 * ramp of 60 ticks, speed 50 to about 19 and speed 100 to 6.
 * unverified: that a longer ramp is a slower breath on the keyboard.
 */
export function breathingTiming(speed: number): { count: number; value1: number; value2: number } {
  const clamped = Math.min(100, Math.max(0, speed))
  const count = Math.round(60 * 0.1 ** (clamped / 100))
  return { count, value1: Math.floor(100 / count), value2: BREATHING_STAY }
}

function breathingEffect(lighting: LightingState, map: KeyIndexMap): DynamicLightingEffect {
  const locationOf = (keyId: string): number => {
    const code = map.location[keyId]
    if (code === undefined) throw new RangeError(`No lighting location code for key ${keyId}`)
    return code
  }

  // Group the lit keys by their final color. Keys with the same color share one parameter.
  const groups = new Map<string, { color: Rgba; keys: number[] }>()
  const add = (keyId: string, color: RGBColor): void => {
    const rgba = { ...scale(color, lighting.brightness), a: 0 }
    const id = `${rgba.r},${rgba.g},${rgba.b}`
    const group = groups.get(id) ?? { color: rgba, keys: [] }
    group.keys.push(locationOf(keyId))
    groups.set(id, group)
  }
  const perKey = Object.entries(lighting.perKey)
  if (perKey.length > 0) for (const [keyId, color] of perKey) add(keyId, color)
  else for (const keyId of Object.keys(map.location)) add(keyId, lighting.color)

  if (groups.size > BREATHING_MAX_COLORS) {
    throw new UnsupportedLightingError(
      `Breathing supports at most ${BREATHING_MAX_COLORS} different colors, got ${groups.size}`,
    )
  }

  const { value1, value2 } = breathingTiming(lighting.speed)
  const params: DynamicLightingParam[] = [...groups.values()].map((group) => ({
    // The reference leaves alpha at 0 in dynamic parameters. Only static keys use 0xFF.
    colorType: LIGHTING_COLOR_TYPE.breathing,
    keys: [...group.keys].sort((a, b) => a - b),
    color: group.color,
    value1,
    value2,
  }))
  const lit = [...groups.values()].flatMap((group) => group.keys).sort((a, b) => a - b)
  return { type: 'dynamic', frames: [{ count: 1, keys: lit }], params }
}

/**
 * Maps the semantic lighting state to device effect records.
 *
 * Supported: `off` (and `enabled: false`), `solid`, `per-key`. All three become one static effect.
 * - off: every slot 0 (alpha 0). unverified: that the firmware leaves such keys dark. The reference
 *   leaves unset keys of a static effect at 0 and its logger treats alpha 0 as "not lit".
 * - brightness: the static record has no brightness field, so the colors are scaled by `brightness / 100`
 *   before encoding (software dimming). Keyboard-wide brightness is a key function in the firmware.
 * - speed and direction have no meaning for static colors and are ignored.
 * - breathing: one dynamic effect. One parameter per distinct color, each with the keys of that color. With no
 *   per-key colors every key breathes in `color`. With per-key colors only those keys breathe, the others stay
 *   dark. `speed` sets the ramp length (see `breathingTiming`). `direction` is ignored.
 * - rainbow, wave, reactive: not supported. Throws `UnsupportedLightingError`.
 */
export function lightingToEffects(lighting: LightingState, map: KeyIndexMap): LightingEffectRecord[] {
  const colors: Record<number, Rgba> = {}

  const locationOf = (keyId: string): number => {
    const code = map.location[keyId]
    if (code === undefined) throw new RangeError(`No lighting location code for key ${keyId}`)
    return code
  }

  if (lighting.enabled && lighting.effect !== 'off') {
    if (lighting.effect === 'solid') {
      for (const keyId of Object.keys(map.location)) colors[locationOf(keyId)] = scale(lighting.color, lighting.brightness)
    } else if (lighting.effect === 'per-key') {
      for (const [keyId, color] of Object.entries(lighting.perKey)) {
        colors[locationOf(keyId)] = scale(color, lighting.brightness)
      }
    } else if (lighting.effect === 'breathing') {
      return [breathingEffect(lighting, map)]
    } else {
      throw new UnsupportedLightingError(
        `Lighting effect "${lighting.effect}" cannot be encoded yet: only off, solid, per-key and breathing are supported`,
      )
    }
  }
  return [{ type: 'static', colors }]
}

// ---------------------------------------------------------------------------
// Per-key press effects (0x26)
// ---------------------------------------------------------------------------

export const KEY_PRESS_EFFECT_NONE = 0xff

/**
 * One byte per logic code: the index of the lighting effect (slot in the 0x27 table) that plays when the
 * key is pressed, or 0xFF for none. The payload length is `logicSize`.
 * unverified: that the index refers to the 0x27 table slot of the same layer (the reference comment only
 * says "which lighting effect to play"), and the 0..31 limit (taken from `MaxEffects`).
 */
export function encodeKeyPressEffectPayload(
  effectByKey: Readonly<Record<string, number>>,
  map: KeyIndexMap,
): Uint8Array {
  const payload = new Uint8Array(map.logicSize).fill(KEY_PRESS_EFFECT_NONE)
  for (const [keyId, effect] of Object.entries(effectByKey)) {
    const index = map.logic[keyId]
    if (index === undefined) throw new RangeError(`No logic code for key ${keyId}`)
    if (!Number.isInteger(effect) || effect < 0 || effect >= LIGHTING_MAX_EFFECTS) {
      throw new RangeError(`Lighting effect index must be 0-${LIGHTING_MAX_EFFECTS - 1}, got ${effect}`)
    }
    payload[index] = effect
  }
  return payload
}

export function decodeKeyPressEffectPayload(payload: Uint8Array, map: KeyIndexMap): Record<string, number> {
  const keyIdByIndex = new Map(Object.entries(map.logic).map(([keyId, index]) => [index, keyId]))
  const result: Record<string, number> = {}
  for (let index = 0; index < map.logicSize; index += 1) {
    const value = payload[index] ?? KEY_PRESS_EFFECT_NONE
    const keyId = keyIdByIndex.get(index)
    if (value !== KEY_PRESS_EFFECT_NONE && keyId !== undefined) result[keyId] = value
  }
  return result
}

/**
 * Reset (0x21, data type 5) then write (0x26).
 * unverified: the reference never calls this. Its opcode table names the type ("KeyPressLightingEffect = 5,
 * Maps to 26 XX") and the framing, so the sequence follows the other three writers.
 */
export function buildKeyPressEffectWrite(layer: DeviceLayer, payload: Uint8Array): Uint8Array[] {
  return [
    buildResetPacket(layer, DATA_TYPE.keyPressLightingEffect),
    ...buildBufferedWrite(WRITE_COMMAND.keyPressLightingEffect, layer, payload),
  ]
}
