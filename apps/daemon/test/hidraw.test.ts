import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPacket, type DeviceSummary } from '@perifmcp/core'
import { NodeHidConnection, toOutputReport, type HidLike } from '../src/transport/hidraw.js'

const info: DeviceSummary = { id: 'fake', vendorId: 0x1ea7, productId: 0x0907 }

class FakeHid extends EventEmitter implements HidLike {
  readonly writes: Buffer[] = []
  closed = false
  /** Called after each write, to simulate the device answering. */
  onWrite: (data: Buffer) => void = () => {}

  write(data: Buffer): number {
    this.writes.push(Buffer.from(data))
    this.onWrite(data)
    return data.length
  }

  close(): void {
    this.closed = true
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('toOutputReport', () => {
  it('prefixes the 64-byte packet with report ID 0x00 and keeps every byte', () => {
    const packet = buildPacket({ command: 0x0c })
    packet[63] = 0xab
    const report = toOutputReport(packet)
    expect(report.length).toBe(65)
    expect(report[0]).toBe(0x00)
    expect(Array.from(report.subarray(1))).toEqual(Array.from(packet))
  })
})

describe('NodeHidConnection', () => {
  it('writes 65 bytes (report ID 0x00 + packet) and resolves with the matching response', async () => {
    const hid = new FakeHid()
    const connection = new NodeHidConnection(hid, info)
    const packet = buildPacket({ command: 0x01, subCommand: 0x08 })
    const response = buildPacket({ command: 0x01, subCommand: 0x08, body: Uint8Array.of(7, 0, 0, 0) })
    hid.onWrite = () => {
      hid.emit('data', Buffer.from(response))
    }

    const result = await connection.send(packet)

    expect(hid.writes).toHaveLength(1)
    expect(hid.writes[0]?.length).toBe(65)
    expect(hid.writes[0]?.[0]).toBe(0x00)
    expect(Array.from(hid.writes[0]?.subarray(1) ?? [])).toEqual(Array.from(packet))
    expect(result.length).toBe(64)
    expect(result[8]).toBe(7)
    expect(hid.listenerCount('data')).toBe(0)
    expect(hid.listenerCount('error')).toBe(0)
  })

  it('ignores reports for other commands and strips a leading report ID from responses', async () => {
    const hid = new FakeHid()
    const connection = new NodeHidConnection(hid, info)
    const response = buildPacket({ command: 0x0c })
    hid.onWrite = () => {
      hid.emit('data', Buffer.from(buildPacket({ command: 0x15 })))
      hid.emit('data', Buffer.concat([Buffer.from([0x00]), Buffer.from(response)]))
    }

    const result = await connection.send(buildPacket({ command: 0x0c }))

    expect(result[0]).toBe(0x0c)
    expect(result.length).toBe(64)
  })

  it('rejects packets that are not 64 bytes without writing', async () => {
    const hid = new FakeHid()
    const connection = new NodeHidConnection(hid, info)

    await expect(connection.send(new Uint8Array(65))).rejects.toThrow(RangeError)
    await expect(connection.send(new Uint8Array(63))).rejects.toThrow(RangeError)
    expect(hid.writes).toHaveLength(0)
  })

  it('rejects on timeout and removes its listeners', async () => {
    vi.useFakeTimers()
    const hid = new FakeHid()
    const connection = new NodeHidConnection(hid, info)

    const pending = connection.send(buildPacket({ command: 0x0c }), 100)
    const assertion = expect(pending).rejects.toThrow(/timeout/)
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    expect(hid.listenerCount('data')).toBe(0)
  })

  it('rejects when the write throws', async () => {
    const hid = new FakeHid()
    hid.onWrite = () => {
      throw new Error('write failed')
    }
    const connection = new NodeHidConnection(hid, info)

    await expect(connection.send(buildPacket({ command: 0x0c }))).rejects.toThrow('write failed')
    expect(hid.listenerCount('data')).toBe(0)
  })

  it('closes the underlying device', async () => {
    const hid = new FakeHid()
    await new NodeHidConnection(hid, info).close()
    expect(hid.closed).toBe(true)
  })
})
