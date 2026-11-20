import type { KeyDefinition, KeyboardLayout } from './types.js'

type KeyInput = Omit<KeyDefinition, 'y' | 'width'> & { width?: number }

function key(input: KeyInput): KeyDefinition {
  return {
    ...input,
    y: input.row,
    width: input.width ?? 1,
  }
}

const row1: KeyDefinition[] = [
  key({ id: 'escape', label: 'Esc', x: 0, row: 0, zone: 'modifier' }),
  key({ id: 'digit1', label: '1', legend: '!', x: 1, row: 0, zone: 'main' }),
  key({ id: 'digit2', label: '2', legend: '@', x: 2, row: 0, zone: 'main' }),
  key({ id: 'digit3', label: '3', legend: '#', x: 3, row: 0, zone: 'main' }),
  key({ id: 'digit4', label: '4', legend: '$', x: 4, row: 0, zone: 'main' }),
  key({ id: 'digit5', label: '5', legend: '%', x: 5, row: 0, zone: 'main' }),
  key({ id: 'digit6', label: '6', legend: '^', x: 6, row: 0, zone: 'main' }),
  key({ id: 'digit7', label: '7', legend: '&', x: 7, row: 0, zone: 'main' }),
  key({ id: 'digit8', label: '8', legend: '*', x: 8, row: 0, zone: 'main' }),
  key({ id: 'digit9', label: '9', legend: '(', x: 9, row: 0, zone: 'main' }),
  key({ id: 'digit0', label: '0', legend: ')', x: 10, row: 0, zone: 'main' }),
  key({ id: 'minus', label: '-', legend: '_', x: 11, row: 0, zone: 'main' }),
  key({ id: 'equal', label: '=', legend: '+', x: 12, row: 0, zone: 'main' }),
  key({ id: 'backspace', label: '⌫', x: 13, row: 0, zone: 'modifier', width: 2 }),
]

const row2: KeyDefinition[] = [
  key({ id: 'tab', label: 'Tab', x: 0, row: 1, zone: 'modifier', width: 1.5 }),
  key({ id: 'q', label: 'Q', x: 1.5, row: 1, zone: 'main' }),
  key({ id: 'w', label: 'W', x: 2.5, row: 1, zone: 'main' }),
  key({ id: 'e', label: 'E', x: 3.5, row: 1, zone: 'main' }),
  key({ id: 'r', label: 'R', x: 4.5, row: 1, zone: 'main' }),
  key({ id: 't', label: 'T', x: 5.5, row: 1, zone: 'main' }),
  key({ id: 'y', label: 'Y', x: 6.5, row: 1, zone: 'main' }),
  key({ id: 'u', label: 'U', x: 7.5, row: 1, zone: 'main' }),
  key({ id: 'i', label: 'I', x: 8.5, row: 1, zone: 'main' }),
  key({ id: 'o', label: 'O', x: 9.5, row: 1, zone: 'main' }),
  key({ id: 'p', label: 'P', x: 10.5, row: 1, zone: 'main' }),
  key({ id: 'bracketleft', label: '[', legend: '{', x: 11.5, row: 1, zone: 'main' }),
  key({ id: 'bracketright', label: ']', legend: '}', x: 12.5, row: 1, zone: 'main' }),
  key({ id: 'backslash', label: '\\', legend: '|', x: 13.5, row: 1, zone: 'main', width: 1.5 }),
]

const row3: KeyDefinition[] = [
  key({ id: 'capslock', label: 'Caps', x: 0, row: 2, zone: 'modifier', width: 1.75 }),
  key({ id: 'a', label: 'A', x: 1.75, row: 2, zone: 'main' }),
  key({ id: 's', label: 'S', x: 2.75, row: 2, zone: 'main' }),
  key({ id: 'd', label: 'D', x: 3.75, row: 2, zone: 'main' }),
  key({ id: 'f', label: 'F', x: 4.75, row: 2, zone: 'main' }),
  key({ id: 'g', label: 'G', x: 5.75, row: 2, zone: 'main' }),
  key({ id: 'h', label: 'H', x: 6.75, row: 2, zone: 'main' }),
  key({ id: 'j', label: 'J', x: 7.75, row: 2, zone: 'main' }),
  key({ id: 'k', label: 'K', x: 8.75, row: 2, zone: 'main' }),
  key({ id: 'l', label: 'L', x: 9.75, row: 2, zone: 'main' }),
  key({ id: 'semicolon', label: ';', legend: ':', x: 10.75, row: 2, zone: 'main' }),
  key({ id: 'quote', label: "'", legend: '"', x: 11.75, row: 2, zone: 'main' }),
  key({ id: 'enter', label: 'Enter', x: 12.75, row: 2, zone: 'modifier', width: 2.25 }),
]

const row4: KeyDefinition[] = [
  key({ id: 'lshift', label: 'Shift', x: 0, row: 3, zone: 'modifier', width: 2 }),
  key({ id: 'z', label: 'Z', x: 2, row: 3, zone: 'main' }),
  key({ id: 'x', label: 'X', x: 3, row: 3, zone: 'main' }),
  key({ id: 'c', label: 'C', x: 4, row: 3, zone: 'main' }),
  key({ id: 'v', label: 'V', x: 5, row: 3, zone: 'main' }),
  key({ id: 'b', label: 'B', x: 6, row: 3, zone: 'main' }),
  key({ id: 'n', label: 'N', x: 7, row: 3, zone: 'main' }),
  key({ id: 'm', label: 'M', x: 8, row: 3, zone: 'main' }),
  key({ id: 'comma', label: ',', legend: '<', x: 9, row: 3, zone: 'main' }),
  key({ id: 'period', label: '.', legend: '>', x: 10, row: 3, zone: 'main' }),
  key({ id: 'slash', label: '/', legend: '?', x: 11, row: 3, zone: 'main' }),
  key({ id: 'rshift', label: 'Shift', x: 12, row: 3, zone: 'modifier' }),
  key({ id: 'arrowup', label: '↑', x: 13, row: 3, zone: 'arrow' }),
  key({ id: 'delete', label: 'Del', x: 14, row: 3, zone: 'navigation' }),
]

const row5: KeyDefinition[] = [
  key({ id: 'lctrl', label: 'Ctrl', x: 0, row: 4, zone: 'modifier', width: 1.25 }),
  key({ id: 'lwin', label: 'Win', x: 1.25, row: 4, zone: 'modifier', width: 1.25 }),
  key({ id: 'lalt', label: 'Alt', x: 2.5, row: 4, zone: 'modifier', width: 1.25 }),
  key({ id: 'space', label: 'Space', x: 3.75, row: 4, zone: 'main', width: 6.25 }),
  key({ id: 'fn', label: 'Fn', x: 10, row: 4, zone: 'modifier' }),
  key({ id: 'menu', label: 'Menu', x: 11, row: 4, zone: 'modifier' }),
  key({ id: 'arrowleft', label: '←', x: 12, row: 4, zone: 'arrow' }),
  key({ id: 'arrowdown', label: '↓', x: 13, row: 4, zone: 'arrow' }),
  key({ id: 'arrowright', label: '→', x: 14, row: 4, zone: 'arrow' }),
]

export const GIM_K64_LAYOUT: KeyboardLayout = {
  id: 'gim-k64-ansi',
  name: 'GIM K64 RGB (ANSI, 64 keys)',
  standard: 'ANSI',
  keyCount: 64,
  width: 15,
  rows: 5,
  keys: [...row1, ...row2, ...row3, ...row4, ...row5],
}

export const DEFAULT_LAYOUT = GIM_K64_LAYOUT
