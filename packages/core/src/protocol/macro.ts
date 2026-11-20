/**
 * Macro model and binary format (0x25 record).
 *
 * Source: GK6X/KeyboardDevice.cs `SetMacros`, GK6X/UserDataFile.cs `Macro` and the macro
 * parser in `UserDataFile.Load`, GK6X/Enums.cs (`MacroRepeatType`, `MacroKeyType`,
 * `MacroKeyState`), GK6X/CommandLogger.cs `ProcessBufferedPacket` (`LayerSetMacros`, decoder side).
 *
 * Record layout (little endian), one record per macro, `MACRO_RECORD_SIZE` bytes:
 *
 *   0   u16  magic 0x55AA (bytes AA 55)
 *   2   u16  CRC-16/CCITT-FALSE over the first `intCount * 4` bytes of the slot area
 *   4   u8   intCount = actions * 2, minus 1 when the last action has no delay part
 *   5   u8   macro index (the key value for a macro key is 0x0A010000 + index)
 *   6   u8   repeat type (1 = repeat N times, 2 = until key released, 3 = until key pressed again)
 *   7   u8   repeat count
 *   8   63 slots of 8 bytes: keyCode u8, modifier u8, state u8 (1 down, 2 up), type u8 (1 key, 2 mouse),
 *            delay u16, 0x00, 0x03 (the last 4 bytes are zero when the action has no delay part)
 *
 * The reference encoder appends one more zero byte after every record (513 bytes). The reference
 * packet logger, which decodes real vendor traffic, requires a 512 byte stride. This module uses 512.
 * unverified: which of the two the firmware needs when more than one macro is written.
 */
import type { Macro, MacroStep, Modifier } from '../types.js'
import { crc16ccitt } from './crc16.js'
import { DATA_TYPE, WRITE_COMMAND, buildBufferedWrite, buildResetPacket, type DeviceLayer } from './framing.js'
import { KEYBOARD_USAGE, KEYBOARD_USAGE_BY_VALUE, MODIFIER_BITS, MODIFIER_CODE_BY_BIT, MODIFIER_KEY_BITS } from './keycodes.js'

export const MACRO_MAGIC = 0x55aa
export const MACRO_MAX_ACTIONS = 63
export const MACRO_SLOT_SIZE = 8
export const MACRO_HEADER_SIZE = 8
export const MACRO_RECORD_SIZE = MACRO_HEADER_SIZE + MACRO_MAX_ACTIONS * MACRO_SLOT_SIZE

export const MACRO_REPEAT_TYPE = {
  repeatXTimes: 1,
  releaseKeyToStop: 2,
  pressKeyAgainToStop: 3,
} as const

export const MACRO_KEY_STATE = { down: 1, up: 2 } as const
export const MACRO_KEY_TYPE = { key: 1, mouse: 2 } as const

export interface MacroAction {
  /** HID keyboard usage, or a mouse button mask when `type` is mouse. 0 for modifier actions. */
  keyCode: number
  /** Modifier bit mask. Modifiers are separate actions, not flags on a key. */
  modifier: number
  state: number
  type: number
  /** unverified: unit. The reference logger comment says "up to 65535 milliseconds". */
  delay: number
}

export interface MacroRecordInput {
  index: number
  actions: MacroAction[]
  repeatType?: number
  repeatCount?: number
  /** True when the last action carries a delay (useful when the macro repeats). */
  trailingDelay?: boolean
}

export interface DecodedMacroRecord {
  index: number
  repeatType: number
  repeatCount: number
  actions: MacroAction[]
  trailingDelay: boolean
}

/** Number of device actions a key step expands to (modifiers down, key down, modifiers up, key up). */
export function keyStepActionCount(step: Extract<MacroStep, { type: 'key' }>): number {
  return 2 * (new Set(step.modifiers ?? []).size + 1)
}

export function macroActionCount(steps: readonly MacroStep[]): number {
  let count = 0
  for (const step of steps) {
    if (step.type === 'key') count += keyStepActionCount(step)
  }
  return count
}

const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'gui']

function keyActions(code: string, modifiers: readonly Modifier[] | undefined): Array<Pick<MacroAction, 'keyCode' | 'modifier'>> {
  const keys: Array<Pick<MacroAction, 'keyCode' | 'modifier'>> = []
  const requested = new Set(modifiers ?? [])
  for (const modifier of MODIFIER_ORDER) {
    if (requested.has(modifier)) keys.push({ keyCode: 0, modifier: MODIFIER_BITS[modifier] })
  }
  const modifierBit = MODIFIER_KEY_BITS[code]
  if (modifierBit !== undefined) {
    keys.push({ keyCode: 0, modifier: modifierBit })
  } else {
    const usage = KEYBOARD_USAGE[code]
    if (usage === undefined) {
      throw new RangeError(`Key code "${code}" cannot be used in a macro`)
    }
    keys.push({ keyCode: usage, modifier: 0 })
  }
  return keys
}

/**
 * Expands semantic steps to device actions.
 * A key step presses all its keys in order (modifiers first), then releases them in the same
 * order. This is the order the reference parser produces for `press: ctrl+c`.
 * A delay step sets the delay of the previous action. A delay before any key is rejected.
 */
export function macroStepsToActions(steps: readonly MacroStep[]): { actions: MacroAction[]; trailingDelay: boolean } {
  const actions: MacroAction[] = []
  let trailingDelay = false

  for (const step of steps) {
    if (step.type === 'key') {
      const keys = keyActions(step.code, step.modifiers)
      for (const state of [MACRO_KEY_STATE.down, MACRO_KEY_STATE.up]) {
        for (const key of keys) {
          actions.push({ ...key, state, type: MACRO_KEY_TYPE.key, delay: 0 })
        }
      }
      trailingDelay = false
    } else {
      const last = actions[actions.length - 1]
      if (last === undefined) {
        throw new RangeError('A macro cannot start with a delay step')
      }
      if (!Number.isInteger(step.ms) || step.ms < 0) {
        throw new RangeError(`Invalid delay ${step.ms}`)
      }
      last.delay += step.ms
      if (last.delay > 0xffff) {
        throw new RangeError('Accumulated delay exceeds 65535')
      }
      trailingDelay = last.delay > 0
    }
  }

  if (actions.length > MACRO_MAX_ACTIONS) {
    throw new RangeError(`Macro expands to ${actions.length} actions, the limit is ${MACRO_MAX_ACTIONS}`)
  }
  return { actions, trailingDelay }
}

/** Inverse of `macroStepsToActions` for macros it produced. Anything else throws. */
export function macroActionsToSteps(actions: readonly MacroAction[]): MacroStep[] {
  const steps: MacroStep[] = []
  let index = 0

  while (index < actions.length) {
    // Collect the down run, then expect the matching up run in the same order.
    const down: MacroAction[] = []
    while (index < actions.length && actions[index]?.state === MACRO_KEY_STATE.down) {
      down.push(actions[index] as MacroAction)
      index += 1
    }
    const up = actions.slice(index, index + down.length)
    index += down.length
    if (down.length === 0 || up.length !== down.length) {
      throw new RangeError('Macro actions are not balanced press/release runs')
    }
    for (let i = 0; i < down.length; i += 1) {
      const a = down[i] as MacroAction
      const b = up[i] as MacroAction
      if (b.state !== MACRO_KEY_STATE.up || a.keyCode !== b.keyCode || a.modifier !== b.modifier || a.type !== b.type) {
        throw new RangeError('Macro release does not mirror its press')
      }
      if (a.type !== MACRO_KEY_TYPE.key) {
        throw new RangeError('Mouse macro actions have no semantic equivalent')
      }
    }

    if (down.some((action) => action.delay !== 0) || up.slice(0, -1).some((action) => action.delay !== 0)) {
      throw new RangeError('Delay inside a key step has no semantic equivalent')
    }

    const modifiers: Modifier[] = []
    let code: string | undefined
    for (let i = 0; i < down.length; i += 1) {
      const action = down[i] as MacroAction
      if (action.keyCode !== 0) {
        code = KEYBOARD_USAGE_BY_VALUE.get(action.keyCode)
        if (code === undefined) throw new RangeError(`Unknown keyboard usage 0x${action.keyCode.toString(16)}`)
      } else {
        const modifier = MODIFIER_ORDER.find((name) => MODIFIER_BITS[name] === action.modifier)
        if (modifier !== undefined && i < down.length - 1) {
          modifiers.push(modifier)
        } else {
          code = MODIFIER_CODE_BY_BIT.get(action.modifier)
          if (code === undefined) throw new RangeError(`Unknown modifier 0x${action.modifier.toString(16)}`)
        }
      }
    }
    if (code === undefined) throw new RangeError('Macro key step without a key')
    steps.push(modifiers.length > 0 ? { type: 'key', code, modifiers } : { type: 'key', code })

    const lastUp = up[up.length - 1] as MacroAction
    if (lastUp.delay > 0) steps.push({ type: 'delay', ms: lastUp.delay })
  }
  return steps
}

export function encodeMacroRecord(input: MacroRecordInput): Uint8Array {
  const { actions } = input
  if (actions.length === 0) throw new RangeError('A macro needs at least one action')
  if (actions.length > MACRO_MAX_ACTIONS) {
    throw new RangeError(`A macro holds at most ${MACRO_MAX_ACTIONS} actions`)
  }
  assertByte(input.index, 'macro index')
  const repeatType = input.repeatType ?? MACRO_REPEAT_TYPE.repeatXTimes
  const repeatCount = input.repeatCount ?? 1
  assertByte(repeatType, 'repeat type')
  assertByte(repeatCount, 'repeat count')
  const trailingDelay = input.trailingDelay ?? false

  const record = new Uint8Array(MACRO_RECORD_SIZE)
  const intCount = actions.length * 2 - (trailingDelay ? 0 : 1)
  record[0] = MACRO_MAGIC & 0xff
  record[1] = MACRO_MAGIC >> 8
  record[4] = intCount
  record[5] = input.index
  record[6] = repeatType
  record[7] = repeatCount

  actions.forEach((action, i) => {
    const offset = MACRO_HEADER_SIZE + i * MACRO_SLOT_SIZE
    record[offset] = action.keyCode
    record[offset + 1] = action.modifier
    record[offset + 2] = action.state
    record[offset + 3] = action.type
    const hasDelayPart = i < actions.length - 1 || (trailingDelay && i === actions.length - 1)
    if (hasDelayPart) {
      record[offset + 4] = action.delay & 0xff
      record[offset + 5] = (action.delay >> 8) & 0xff
      record[offset + 6] = 0
      record[offset + 7] = 3
    }
  })

  const crc = crc16ccitt(record.subarray(MACRO_HEADER_SIZE, MACRO_HEADER_SIZE + intCount * 4))
  record[2] = crc & 0xff
  record[3] = crc >> 8
  return record
}

export function decodeMacroRecord(record: Uint8Array): DecodedMacroRecord {
  if (record.length < MACRO_RECORD_SIZE) {
    throw new RangeError(`Macro record must be ${MACRO_RECORD_SIZE} bytes, got ${record.length}`)
  }
  const magic = (record[0] ?? 0) | ((record[1] ?? 0) << 8)
  if (magic !== MACRO_MAGIC) throw new Error('Invalid macro magic')

  const intCount = record[4] ?? 0
  const storedCrc = (record[2] ?? 0) | ((record[3] ?? 0) << 8)
  const crc = crc16ccitt(record.subarray(MACRO_HEADER_SIZE, MACRO_HEADER_SIZE + intCount * 4))
  if (crc !== storedCrc) throw new Error('Macro CRC mismatch')

  const actionCount = Math.ceil(intCount / 2)
  const trailingDelay = intCount % 2 === 0
  if (actionCount > MACRO_MAX_ACTIONS) throw new RangeError('Macro action count out of range')

  const actions: MacroAction[] = []
  for (let i = 0; i < actionCount; i += 1) {
    const offset = MACRO_HEADER_SIZE + i * MACRO_SLOT_SIZE
    actions.push({
      keyCode: record[offset] ?? 0,
      modifier: record[offset + 1] ?? 0,
      state: record[offset + 2] ?? 0,
      type: record[offset + 3] ?? 0,
      delay: (record[offset + 4] ?? 0) | ((record[offset + 5] ?? 0) << 8),
    })
  }

  return {
    index: record[5] ?? 0,
    repeatType: record[6] ?? 0,
    repeatCount: record[7] ?? 0,
    actions,
    trailingDelay,
  }
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be an integer between 0 and 255`)
  }
}

// ---------------------------------------------------------------------------
// Whole macro tables
// ---------------------------------------------------------------------------

/**
 * Encodes every macro of the config into one payload. The device index of a macro is its position in
 * the array, so the key value of a macro key is `0x0A010000 + position`.
 * Repeat: `repeat` (default 1) with repeat type "repeat N times". The other repeat types have no
 * semantic equivalent yet.
 */
export function encodeMacroPayload(macros: readonly Macro[]): Uint8Array {
  const records = macros.map((macro, index) => {
    const { actions, trailingDelay } = macroStepsToActions(macro.steps)
    return encodeMacroRecord({
      index,
      actions,
      repeatType: MACRO_REPEAT_TYPE.repeatXTimes,
      repeatCount: macro.repeat ?? 1,
      trailingDelay,
    })
  })
  const payload = new Uint8Array(records.length * MACRO_RECORD_SIZE)
  records.forEach((record, index) => payload.set(record, index * MACRO_RECORD_SIZE))
  return payload
}

/** Splits a payload into records. Trailing bytes shorter than a record (chunk padding) are ignored. */
export function decodeMacroPayload(payload: Uint8Array): DecodedMacroRecord[] {
  const count = Math.floor(payload.length / MACRO_RECORD_SIZE)
  const records: DecodedMacroRecord[] = []
  for (let index = 0; index < count; index += 1) {
    records.push(decodeMacroRecord(payload.subarray(index * MACRO_RECORD_SIZE, (index + 1) * MACRO_RECORD_SIZE)))
  }
  return records
}

/**
 * Back to semantic macros. The device stores no names, so `ids[index]` provides the id (and the name);
 * missing ids become `macro<index>`. `repeat` is omitted when it is 1.
 */
export function decodeMacros(payload: Uint8Array, ids: readonly string[] = []): Macro[] {
  return decodeMacroPayload(payload).map((record) => {
    if (record.repeatType !== MACRO_REPEAT_TYPE.repeatXTimes) {
      throw new RangeError(`Macro ${record.index} uses repeat type ${record.repeatType}, which the model cannot express`)
    }
    const id = ids[record.index] ?? `macro${record.index}`
    const macro: Macro = { id, name: id, steps: macroActionsToSteps(record.actions) }
    if (record.repeatCount !== 1) macro.repeat = record.repeatCount
    return macro
  })
}

/** Reset (0x21, data type 4) then write (0x25). Same order as `KeyboardDevice.SetMacros`. */
export function buildMacroWrite(layer: DeviceLayer, macros: readonly Macro[]): Uint8Array[] {
  return [
    buildResetPacket(layer, DATA_TYPE.macros),
    ...buildBufferedWrite(WRITE_COMMAND.macros, layer, encodeMacroPayload(macros)),
  ]
}
