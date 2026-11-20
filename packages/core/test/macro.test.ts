import { describe, expect, it } from 'vitest'
import {
  MACRO_MAX_ACTIONS,
  MACRO_RECORD_SIZE,
  crc16ccitt,
  decodeMacroRecord,
  encodeMacroPayload,
  encodeMacroRecord,
  macroActionCount,
  macroActionsToSteps,
  macroStepsToActions,
  type Macro,
  type MacroStep,
} from '../src/index.js'

describe('macro expansion', () => {
  it('presses all keys in order, then releases them in the same order', () => {
    const { actions, trailingDelay } = macroStepsToActions([{ type: 'key', code: 'c', modifiers: ['shift', 'ctrl'] }])
    expect(trailingDelay).toBe(false)
    // Modifiers come in fixed order ctrl, shift, alt, gui regardless of how they were listed.
    expect(actions.map((a) => [a.keyCode, a.modifier, a.state])).toEqual([
      [0, 0x01, 1],
      [0, 0x02, 1],
      [0x06, 0, 1],
      [0, 0x01, 2],
      [0, 0x02, 2],
      [0x06, 0, 2],
    ])
  })

  it('attaches a delay to the previous action and flags a trailing delay', () => {
    const { actions, trailingDelay } = macroStepsToActions([
      { type: 'key', code: 'a' },
      { type: 'delay', ms: 30 },
      { type: 'delay', ms: 20 },
      { type: 'key', code: 'b' },
      { type: 'delay', ms: 5 },
    ])
    expect(actions.map((a) => a.delay)).toEqual([0, 50, 0, 5])
    expect(trailingDelay).toBe(true)
  })

  it('uses the modifier byte for modifier keys and rejects non-macro codes', () => {
    const { actions } = macroStepsToActions([{ type: 'key', code: 'rshift' }])
    expect(actions.map((a) => [a.keyCode, a.modifier])).toEqual([
      [0, 0x20],
      [0, 0x20],
    ])
    expect(() => macroStepsToActions([{ type: 'key', code: 'volumeup' }])).toThrow(/cannot be used in a macro/)
  })

  it('rejects a leading delay, an overflowing delay and too many actions', () => {
    expect(() => macroStepsToActions([{ type: 'delay', ms: 1 }])).toThrow(/start with a delay/)
    expect(() =>
      macroStepsToActions([{ type: 'key', code: 'a' }, { type: 'delay', ms: 40000 }, { type: 'delay', ms: 40000 }]),
    ).toThrow(/exceeds 65535/)
    const many: MacroStep[] = Array.from({ length: 32 }, () => ({ type: 'key', code: 'a' }))
    expect(macroActionCount(many)).toBe(64)
    expect(() => macroStepsToActions(many)).toThrow(/limit is 63/)
  })

  it('round-trips steps through actions', () => {
    const steps: MacroStep[] = [
      { type: 'key', code: 'c', modifiers: ['ctrl'] },
      { type: 'delay', ms: 100 },
      { type: 'key', code: 'lshift' },
      { type: 'key', code: 'enter', modifiers: ['alt', 'gui'] },
      { type: 'delay', ms: 7 },
    ]
    expect(macroActionsToSteps(macroStepsToActions(steps).actions)).toEqual(steps)
  })

  it('refuses actions that are not press/release pairs', () => {
    const down = { keyCode: 4, modifier: 0, state: 1, type: 1, delay: 0 }
    expect(() => macroActionsToSteps([down])).toThrow(/not balanced/)
    expect(() => macroActionsToSteps([down, { ...down, keyCode: 5, state: 2 }])).toThrow(/mirror/)
    expect(() => macroActionsToSteps([{ ...down, delay: 3 }, { ...down, state: 2 }])).toThrow(/inside a key step/)
  })
})

describe('macro records', () => {
  const action = { keyCode: 4, modifier: 0, state: 1, type: 1, delay: 0 }

  it('has a fixed size and a CRC over intCount * 4 bytes of the slot area', () => {
    const record = encodeMacroRecord({ index: 2, actions: [action, { ...action, state: 2 }], repeatCount: 3 })
    expect(record).toHaveLength(MACRO_RECORD_SIZE)
    expect(record[4]).toBe(3) // 2 actions * 2 - 1
    expect(record[5]).toBe(2)
    expect(record[6]).toBe(1)
    expect(record[7]).toBe(3)
    expect(((record[2] as number) | ((record[3] as number) << 8))).toBe(crc16ccitt(record.subarray(8, 8 + 12)))
  })

  it('round-trips through decodeMacroRecord and detects corruption', () => {
    const actions = [action, { ...action, state: 2, delay: 12 }]
    const decoded = decodeMacroRecord(encodeMacroRecord({ index: 5, actions, repeatCount: 4, trailingDelay: true }))
    expect(decoded).toEqual({ index: 5, repeatType: 1, repeatCount: 4, actions, trailingDelay: true })

    const bad = encodeMacroRecord({ index: 0, actions })
    bad[8] = 9
    expect(() => decodeMacroRecord(bad)).toThrow(/CRC/)
    const noMagic = encodeMacroRecord({ index: 0, actions })
    noMagic[0] = 0
    expect(() => decodeMacroRecord(noMagic)).toThrow(/magic/)
  })

  it('rejects empty macros, too many actions and bad bytes', () => {
    expect(() => encodeMacroRecord({ index: 0, actions: [] })).toThrow(/at least one/)
    expect(() => encodeMacroRecord({ index: 0, actions: Array.from({ length: MACRO_MAX_ACTIONS + 1 }, () => action) })).toThrow(/at most/)
    expect(() => encodeMacroRecord({ index: 256, actions: [action] })).toThrow(/macro index/)
    expect(() => encodeMacroRecord({ index: 0, actions: [action], repeatCount: 300 })).toThrow(/repeat count/)
  })

  it('numbers macros by position and rejects an invalid macro', () => {
    const macros: Macro[] = [
      { id: 'x', name: 'x', steps: [{ type: 'key', code: 'x' }] },
      { id: 'y', name: 'y', steps: [{ type: 'key', code: 'y' }] },
    ]
    const payload = encodeMacroPayload(macros)
    expect(payload).toHaveLength(2 * MACRO_RECORD_SIZE)
    expect(payload[5]).toBe(0)
    expect(payload[MACRO_RECORD_SIZE + 5]).toBe(1)
    expect(() => encodeMacroPayload([{ id: 'e', name: 'e', steps: [] }])).toThrow(/at least one/)
    expect(encodeMacroPayload([])).toHaveLength(0)
  })
})
