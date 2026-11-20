import { describe, expect, it } from 'vitest'
import {
  CommandNotAllowedError,
  FORBIDDEN_COMMANDS,
  buildPacket,
  guardConnection,
  isCommandAllowed,
  type DeviceSummary,
  type HidConnection,
} from '../src/index.js'

const info: DeviceSummary = { id: 'test', vendorId: 0x1ea7, productId: 0x0907 }

function fakeConnection(): HidConnection & { sent: Uint8Array[] } {
  const sent: Uint8Array[] = []
  return {
    info,
    sent,
    async send(packet) {
      sent.push(packet)
      return packet
    },
    async close() {},
  }
}

describe('isCommandAllowed', () => {
  it('allows identification commands in read-only mode', () => {
    expect(isCommandAllowed('read-only', 0x01, 0x01)).toBe(true)
    expect(isCommandAllowed('read-only', 0x01, 0x08)).toBe(true)
    expect(isCommandAllowed('read-only', 0x0c, 0x00)).toBe(true)
  })

  it('rejects write commands in read-only mode', () => {
    for (const command of [0x0b, 0x16, 0x17, 0x21, 0x22, 0x25, 0x26, 0x27, 0x31]) {
      expect(isCommandAllowed('read-only', command, 0)).toBe(false)
    }
  })

  it('rejects unknown info sub-commands', () => {
    expect(isCommandAllowed('read-only', 0x01, 0x7f)).toBe(false)
  })

  it('allows write commands only in read-write mode', () => {
    expect(isCommandAllowed('read-write', 0x22, 0x01)).toBe(true)
  })

  it('never allows restart or the USB identity change', () => {
    for (const command of FORBIDDEN_COMMANDS) {
      for (let sub = 0; sub < 256; sub += 1) {
        expect(isCommandAllowed('read-only', command, sub)).toBe(false)
        expect(isCommandAllowed('read-write', command, sub)).toBe(false)
      }
    }
  })

  it('rejects commands that are not listed', () => {
    expect(isCommandAllowed('read-write', 0x55, 0)).toBe(false)
  })
})

describe('guardConnection', () => {
  it('forwards allowed packets', async () => {
    const inner = fakeConnection()
    const guarded = guardConnection(inner)
    await guarded.send(buildPacket({ command: 0x0c }))
    expect(inner.sent).toHaveLength(1)
  })

  it('defaults to read-only and blocks writes before they reach the device', async () => {
    const inner = fakeConnection()
    const guarded = guardConnection(inner)
    await expect(guarded.send(buildPacket({ command: 0x22, subCommand: 1 }))).rejects.toBeInstanceOf(
      CommandNotAllowedError,
    )
    expect(inner.sent).toHaveLength(0)
  })

  it('blocks writeMacVid even in read-write mode', async () => {
    const inner = fakeConnection()
    const guarded = guardConnection(inner, { mode: 'read-write' })
    await expect(guarded.send(buildPacket({ command: 0x41, subCommand: 1 }))).rejects.toBeInstanceOf(
      CommandNotAllowedError,
    )
    expect(inner.sent).toHaveLength(0)
  })
})
