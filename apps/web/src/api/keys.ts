/**
 * TEMPORARY local key code list.
 *
 * Swap: when `packages/core/src/keys.ts` lands, replace this file with
 *   export { KEY_CODES, isKeyCode } from '@perifmcp/core'
 * Ids follow `layout.ts` (`escape`, `digit1`, `arrowup`) plus extra keys from the public USB HID usage table.
 */
import { GIM_K64_LAYOUT } from '@perifmcp/core'

const EXTRA_CODES = [
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'printscreen', 'scrolllock', 'pause', 'insert', 'home', 'end', 'pageup', 'pagedown',
  'rctrl', 'ralt', 'rwin',
  'mute', 'volumeup', 'volumedown',
] as const

export const KEY_CODES: readonly string[] = [...new Set([...GIM_K64_LAYOUT.keys.map((k) => k.id), ...EXTRA_CODES])]

const CODE_SET: ReadonlySet<string> = new Set(KEY_CODES)

export function isKeyCode(code: string): boolean {
  return CODE_SET.has(code)
}
