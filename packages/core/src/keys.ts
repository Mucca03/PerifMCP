/**
 * Key code vocabulary for `KeyAssignment.code` and `MacroStep.code`.
 *
 * Built from the public USB HID usage tables (see `protocol/keycodes.ts`).
 */
import {
  CONSUMER_USAGE,
  KEYBOARD_USAGE,
  MODIFIER_KEY_BITS,
  SPECIAL_KEY_CODES,
} from './protocol/keycodes.js'

export const KEY_CODES: readonly string[] = Object.freeze([
  ...Object.keys(KEYBOARD_USAGE),
  ...Object.keys(MODIFIER_KEY_BITS),
  ...Object.keys(CONSUMER_USAGE),
  ...SPECIAL_KEY_CODES,
])

const KEY_CODE_SET: ReadonlySet<string> = new Set(KEY_CODES)

export function isKeyCode(code: string): boolean {
  return KEY_CODE_SET.has(code)
}

/**
 * Codes a macro step can use. The macro format carries a keyboard usage or a modifier byte,
 * so consumer keys (volume, browser, ...), `fn` and `disabled` are not allowed in macros.
 */
export function isMacroKeyCode(code: string): boolean {
  return Object.hasOwn(KEYBOARD_USAGE, code) || Object.hasOwn(MODIFIER_KEY_BITS, code)
}
