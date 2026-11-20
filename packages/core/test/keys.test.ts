import { describe, expect, it } from 'vitest'
import {
  GIM_K64_LAYOUT,
  KEY_CODES,
  KEYBOARD_USAGE,
  isKeyCode,
  isMacroKeyCode,
  sha256Hex,
} from '../src/index.js'

describe('key vocabulary', () => {
  it('contains every layout key id', () => {
    for (const key of GIM_K64_LAYOUT.keys) expect(isKeyCode(key.id), key.id).toBe(true)
  })

  it('has unique, lowercase codes', () => {
    expect(new Set(KEY_CODES).size).toBe(KEY_CODES.length)
    for (const code of KEY_CODES) expect(code).toBe(code.toLowerCase())
  })

  it('rejects unknown codes', () => {
    expect(isKeyCode('')).toBe(false)
    expect(isKeyCode('Escape')).toBe(false)
    expect(isKeyCode('toString')).toBe(false)
  })

  it('maps well-known keys to their HID usage', () => {
    expect(KEYBOARD_USAGE.a).toBe(0x04)
    expect(KEYBOARD_USAGE.z).toBe(0x1d)
    expect(KEYBOARD_USAGE.digit1).toBe(0x1e)
    expect(KEYBOARD_USAGE.digit0).toBe(0x27)
    expect(KEYBOARD_USAGE.enter).toBe(0x28)
    expect(KEYBOARD_USAGE.escape).toBe(0x29)
    expect(KEYBOARD_USAGE.space).toBe(0x2c)
    expect(KEYBOARD_USAGE.capslock).toBe(0x39)
    expect(KEYBOARD_USAGE.f1).toBe(0x3a)
    expect(KEYBOARD_USAGE.arrowright).toBe(0x4f)
    expect(KEYBOARD_USAGE.arrowup).toBe(0x52)
  })

  it('limits macro codes to keyboard-page keys and modifiers', () => {
    expect(isMacroKeyCode('a')).toBe(true)
    expect(isMacroKeyCode('lshift')).toBe(true)
    expect(isMacroKeyCode('volumeup')).toBe(false)
    expect(isMacroKeyCode('fn')).toBe(false)
    expect(isMacroKeyCode('disabled')).toBe(false)
  })
})

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})
