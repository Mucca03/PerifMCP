import { describe, expect, it } from 'vitest'
import { KeyboardServiceError } from '@perifmcp/core'
import {
  applyPlanInputSchema,
  keysPlanInputSchema,
  lightingPlanInputSchema,
  macroPlanInputSchema,
  parseConfirmed,
  parseInput,
  restoreInputSchema,
} from '../src/schemas.js'

const okMacro = { id: 'm', name: 'Macro', steps: [{ type: 'key', code: 'a' }] }

describe('keys plan schema', () => {
  it('accepts valid input and rejects unknown keys, layers and extra fields', () => {
    const ok = { layer: 'fn1', assignments: { capslock: { kind: 'key', code: 'escape', modifiers: ['ctrl'] } } }
    expect(keysPlanInputSchema.safeParse(ok).success).toBe(true)
    expect(keysPlanInputSchema.safeParse({ ...ok, layer: 'fn9' }).success).toBe(false)
    expect(keysPlanInputSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
    expect(keysPlanInputSchema.safeParse({ layer: 'base', assignments: { nokey: { kind: 'none' } } }).success).toBe(false)
    expect(keysPlanInputSchema.safeParse({ layer: 'base', assignments: { a: { kind: 'key', code: 'zzz' } } }).success).toBe(false)
    expect(keysPlanInputSchema.safeParse({ layer: 'base', assignments: { a: { kind: 'raw', bytes: [1] } } }).success).toBe(false)
    expect(keysPlanInputSchema.safeParse({ layer: 'base', assignments: {} }).success).toBe(false)
  })
})

describe('macro schema', () => {
  const parse = (macro: unknown): boolean => macroPlanInputSchema.safeParse({ macro }).success

  it('enforces id, name, step, delay and repeat limits', () => {
    expect(parse(okMacro)).toBe(true)
    expect(parse({ ...okMacro, id: '' })).toBe(false)
    expect(parse({ ...okMacro, id: 'a'.repeat(65) })).toBe(false)
    expect(parse({ ...okMacro, id: '../x' })).toBe(false)
    expect(parse({ ...okMacro, name: 'a'.repeat(65) })).toBe(false)
    expect(parse({ ...okMacro, name: 'bad\u0000name' })).toBe(false)
    expect(parse({ ...okMacro, steps: [] })).toBe(false)
    expect(parse({ ...okMacro, steps: Array.from({ length: 256 }, () => ({ type: 'delay', ms: 0 })) })).toBe(true)
    expect(parse({ ...okMacro, steps: Array.from({ length: 257 }, () => ({ type: 'delay', ms: 0 })) })).toBe(false)
    expect(parse({ ...okMacro, steps: [{ type: 'delay', ms: 60000 }] })).toBe(true)
    expect(parse({ ...okMacro, steps: [{ type: 'delay', ms: 60001 }] })).toBe(false)
    expect(parse({ ...okMacro, steps: [{ type: 'delay', ms: -1 }] })).toBe(false)
    expect(parse({ ...okMacro, steps: [{ type: 'delay', ms: 1.5 }] })).toBe(false)
    expect(parse({ ...okMacro, steps: [{ type: 'key', code: 'nope' }] })).toBe(false)
    expect(parse({ ...okMacro, repeat: 1 })).toBe(true)
    expect(parse({ ...okMacro, repeat: 1000 })).toBe(true)
    expect(parse({ ...okMacro, repeat: 0 })).toBe(false)
    expect(parse({ ...okMacro, repeat: 1001 })).toBe(false)
  })
})

describe('lighting schema', () => {
  const parse = (input: unknown): boolean => lightingPlanInputSchema.safeParse(input).success

  it('validates colors, percentages, zones, key ids and effects', () => {
    expect(parse({ base: '#00FF9a', zones: { wasd: '#ffffff' }, perKey: { w: '#000000' }, effect: 'solid' })).toBe(true)
    expect(parse({ base: 'red' })).toBe(false)
    expect(parse({ base: '#fff' })).toBe(false)
    expect(parse({ base: '#12345g' })).toBe(false)
    expect(parse({ base: '#1234567' })).toBe(false)
    expect(parse({ zones: { head: '#ffffff' } })).toBe(false)
    expect(parse({ perKey: { nokey: '#ffffff' } })).toBe(false)
    expect(parse({ effect: 'disco' })).toBe(false)
    expect(parse({ speed: 0, brightness: 100 })).toBe(true)
    expect(parse({ speed: 101 })).toBe(false)
    expect(parse({ brightness: -1 })).toBe(false)
    expect(parse({ brightness: 50.5 })).toBe(false)
    expect(parse({ bytes: [1, 2, 3] })).toBe(false)
  })
})

describe('confirm handling', () => {
  it('maps a missing or non-true confirm to confirmation-required before any other error', () => {
    for (const input of [{}, { planId: 'x' }, { planId: 'x', confirm: false }, { planId: 'x', confirm: 'true' }, { confirm: 1 }, null, 'x']) {
      try {
        parseConfirmed(applyPlanInputSchema, input)
        throw new Error('expected an error')
      } catch (error) {
        expect(error).toBeInstanceOf(KeyboardServiceError)
        expect((error as KeyboardServiceError).code).toBe('confirmation-required')
      }
    }
  })

  it('validates the rest once confirm is true', () => {
    expect(parseConfirmed(restoreInputSchema, { snapshotId: 'abc', confirm: true })).toEqual({ snapshotId: 'abc', confirm: true })
    expect(() => parseConfirmed(restoreInputSchema, { confirm: true })).toThrow(/Invalid input/)
    expect(() => parseConfirmed(restoreInputSchema, { snapshotId: 'a', confirm: true, path: '/etc' })).toThrow(/Invalid input/)
  })
})

describe('parseInput', () => {
  it('turns zod failures into validation errors and drops undefined optionals', () => {
    expect(() => parseInput(keysPlanInputSchema, { layer: 'x' })).toThrow(KeyboardServiceError)
    const parsed = parseInput(macroPlanInputSchema, { macro: { ...okMacro, repeat: undefined } })
    expect('repeat' in parsed.macro).toBe(false)
  })
})
