/**
 * Key vocabulary and USB HID usage values.
 *
 * The usage numbers come from the public "HID Usage Tables for USB" document
 * (Keyboard/Keypad page 0x07 and Consumer page 0x0C). They are not taken from the
 * vendor's `Build/Data/keys.json`.
 *
 * Key ids follow `layout.ts` (`escape`, `digit1`, `arrowup`, `lwin`, ...).
 */

const KEYBOARD_USAGE_ENTRIES: ReadonlyArray<readonly [string, number]> = [
  // Letters: usage 0x04 (A) .. 0x1D (Z)
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((letter, index): readonly [string, number] => [letter, 0x04 + index]),
  // Digits: 1..9 are 0x1E..0x26, 0 is 0x27
  ['digit1', 0x1e],
  ['digit2', 0x1f],
  ['digit3', 0x20],
  ['digit4', 0x21],
  ['digit5', 0x22],
  ['digit6', 0x23],
  ['digit7', 0x24],
  ['digit8', 0x25],
  ['digit9', 0x26],
  ['digit0', 0x27],
  ['enter', 0x28],
  ['escape', 0x29],
  ['backspace', 0x2a],
  ['tab', 0x2b],
  ['space', 0x2c],
  ['minus', 0x2d],
  ['equal', 0x2e],
  ['bracketleft', 0x2f],
  ['bracketright', 0x30],
  ['backslash', 0x31],
  ['semicolon', 0x33],
  ['quote', 0x34],
  ['backquote', 0x35],
  ['comma', 0x36],
  ['period', 0x37],
  ['slash', 0x38],
  ['capslock', 0x39],
  ['f1', 0x3a],
  ['f2', 0x3b],
  ['f3', 0x3c],
  ['f4', 0x3d],
  ['f5', 0x3e],
  ['f6', 0x3f],
  ['f7', 0x40],
  ['f8', 0x41],
  ['f9', 0x42],
  ['f10', 0x43],
  ['f11', 0x44],
  ['f12', 0x45],
  ['printscreen', 0x46],
  ['scrolllock', 0x47],
  ['pause', 0x48],
  ['insert', 0x49],
  ['home', 0x4a],
  ['pageup', 0x4b],
  ['delete', 0x4c],
  ['end', 0x4d],
  ['pagedown', 0x4e],
  ['arrowright', 0x4f],
  ['arrowleft', 0x50],
  ['arrowdown', 0x51],
  ['arrowup', 0x52],
  ['numlock', 0x53],
  ['numpaddivide', 0x54],
  ['numpadmultiply', 0x55],
  ['numpadsubtract', 0x56],
  ['numpadadd', 0x57],
  ['numpadenter', 0x58],
  ['numpad1', 0x59],
  ['numpad2', 0x5a],
  ['numpad3', 0x5b],
  ['numpad4', 0x5c],
  ['numpad5', 0x5d],
  ['numpad6', 0x5e],
  ['numpad7', 0x5f],
  ['numpad8', 0x60],
  ['numpad9', 0x61],
  ['numpad0', 0x62],
  ['numpaddecimal', 0x63],
  ['intlbackslash', 0x64],
  ['menu', 0x65],
  ['f13', 0x68],
  ['f14', 0x69],
  ['f15', 0x6a],
  ['f16', 0x6b],
  ['f17', 0x6c],
  ['f18', 0x6d],
  ['f19', 0x6e],
  ['f20', 0x6f],
  ['f21', 0x70],
  ['f22', 0x71],
  ['f23', 0x72],
  ['f24', 0x73],
]

/** Keyboard/Keypad page usage (0x07) by key code. Modifier keys are not listed here. */
export const KEYBOARD_USAGE: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(KEYBOARD_USAGE_ENTRIES))

/** Modifier bit masks, equal to the HID boot keyboard modifier byte (usages 0xE0..0xE7). */
export const MODIFIER_BITS = {
  ctrl: 0x01,
  shift: 0x02,
  alt: 0x04,
  gui: 0x08,
  altgr: 0x40,
} as const

/** Modifier keys as stand-alone keys. They use the modifier byte, not a usage. */
export const MODIFIER_KEY_BITS: Readonly<Record<string, number>> = Object.freeze({
  lctrl: 0x01,
  lshift: 0x02,
  lalt: 0x04,
  lwin: 0x08,
  rctrl: 0x10,
  rshift: 0x20,
  ralt: 0x40,
  rwin: 0x80,
})

/** Consumer page usages (0x0C), 16 bit. */
export const CONSUMER_USAGE: Readonly<Record<string, number>> = Object.freeze({
  mediaplaypause: 0xcd,
  mediastop: 0xb7,
  mediaprevious: 0xb6,
  medianext: 0xb5,
  volumeup: 0xe9,
  volumedown: 0xea,
  volumemute: 0xe2,
  launchmediaplayer: 0x183,
  launchmail: 0x18a,
  launchcalculator: 0x192,
  launchfilebrowser: 0x194,
  browsersearch: 0x221,
  browserhome: 0x223,
  browserback: 0x224,
  browserforward: 0x225,
  browserstop: 0x226,
  browserrefresh: 0x227,
  browserfavorites: 0x22a,
})

/**
 * Codes that exist as vocabulary but have no usage the firmware understands.
 * - `fn`: the Fn key. The reference tool states its base behaviour cannot be reprogrammed.
 * - `disabled`: the key sends nothing.
 */
export const SPECIAL_KEY_CODES = ['fn', 'disabled'] as const

export const KEYBOARD_USAGE_BY_VALUE: ReadonlyMap<number, string> = new Map(
  KEYBOARD_USAGE_ENTRIES.map(([code, usage]) => [usage, code]),
)

export const CONSUMER_USAGE_BY_VALUE: ReadonlyMap<number, string> = new Map(
  Object.entries(CONSUMER_USAGE).map(([code, usage]) => [usage, code]),
)

export const MODIFIER_CODE_BY_BIT: ReadonlyMap<number, string> = new Map(
  Object.entries(MODIFIER_KEY_BITS).map(([code, bit]) => [bit, code]),
)
