import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KeyboardServiceError, buildPacket, isCommandAllowed } from '@perifmcp/core'
import type { DeviceSummary, HidConnection } from '@perifmcp/core'
import { HidBackend, loadModelRecords, type VendorInterfaceSource } from '../src/backend/index.js'
import { KeyboardServiceImpl } from '../src/service/keyboard-service.js'
import { SnapshotStore } from '../src/service/snapshot-store.js'
import { expectServiceError, makeTempDir } from './helpers.js'

const summary: DeviceSummary = {
  id: 'fake-path',
  vendorId: 0x1ea7,
  productId: 0x0907,
  serialNumber: 'SECRET-SERIAL',
  usagePage: 0xff00,
  path: 'fake-path',
}

interface FakeSource extends VendorInterfaceSource {
  sent: Array<{ command: number; subCommand: number }>
  opened: number
  closed: number
  present: boolean
  openError: Error | undefined
}

/** Answers the identification commands like the keyboard would. Never opens a real device. */
function fakeSource(modelId = 0x1234): FakeSource {
  const source: FakeSource = {
    sent: [],
    opened: 0,
    closed: 0,
    present: true,
    openError: undefined,
    async list() {
      return source.present ? [summary] : []
    },
    async openVendorInterface(): Promise<HidConnection> {
      if (source.openError) throw source.openError
      source.opened += 1
      return {
        info: summary,
        async send(packet) {
          const command = packet[0] ?? 0
          const subCommand = packet[1] ?? 0
          source.sent.push({ command, subCommand })
          const body = new Uint8Array(32)
          if (command === 0x01 && subCommand === 0x01) body.set([0x78, 0x56, 0x34, 0x12, 0x05, 0x00])
          if (command === 0x01 && subCommand === 0x02) body.set([1, 2, 3, 4, 5, 6])
          if (command === 0x01 && subCommand === 0x08) body.set([modelId & 0xff, (modelId >> 8) & 0xff, 0, 0])
          if (command === 0x01 && subCommand === 0x09) body.set([14, 5])
          return buildPacket({ command, subCommand, body })
        },
        async close() {
          source.closed += 1
        },
      }
    },
  }
  return source
}

describe('HidBackend (fake HID source)', () => {
  it('identifies the keyboard using only read-only commands', async () => {
    const source = fakeSource()
    const backend = new HidBackend(source, { models: [{ ModelID: 0x1234, Name: 'Test Model' }] })

    const info = await backend.identify()

    expect(info).toMatchObject({ transport: 'hidraw', modelId: 0x1234, modelName: 'Test Model', matrix: { row: 5, column: 14 } })
    expect(source.sent.length).toBeGreaterThan(0)
    for (const { command, subCommand } of source.sent) {
      expect(isCommandAllowed('read-only', command, subCommand)).toBe(true)
    }
  })

  it('opens the device once and reuses the session', async () => {
    const source = fakeSource()
    const backend = new HidBackend(source)
    await backend.identify()
    const sentAfterFirst = source.sent.length
    await backend.identify()
    expect(source.opened).toBe(1)
    expect(source.sent).toHaveLength(sentAfterFirst)
    await backend.close()
    expect(source.closed).toBe(1)
  })

  it('returns undefined and drops the session when the keyboard is unplugged', async () => {
    const source = fakeSource()
    const backend = new HidBackend(source)
    await backend.identify()
    source.present = false
    expect(await backend.identify()).toBeUndefined()
    expect(source.closed).toBe(1)
  })

  it('cannot write and cannot read the config yet', async () => {
    const backend = new HidBackend(fakeSource())
    expect(backend.supportsWrites).toBe(false)
    await expect(backend.writeChanges([{ type: 'set-settings', settings: { nkro: true, osMode: 'win' } }])).rejects.toMatchObject({
      code: 'write-disabled',
    })
    await expect(backend.readConfig()).rejects.toBeInstanceOf(KeyboardServiceError)
  })

  it('keeps writes disabled in the service even with allowWrites and a known model', async () => {
    const source = fakeSource()
    const backend = new HidBackend(source, { models: [{ ModelID: 0x1234, Name: 'Test Model' }] })
    const service = new KeyboardServiceImpl({
      backend,
      snapshots: new SnapshotStore(await makeTempDir()),
      allowWrites: true,
    })

    const status = await service.status()
    expect(status.transport).toBe('hidraw')
    expect(status.connection).toBe('connected')
    expect(status.writeEnabled).toBe(false)
    expect(status.configRevision).toBe('unavailable')
    expect(status.device?.serialNumber).toBeUndefined()
    await expectServiceError(service.applyPlan('x', true), 'write-disabled')
    await expectServiceError(service.getConfig(), 'device-error')
    expect(source.sent.every((item) => isCommandAllowed('read-only', item.command, item.subCommand))).toBe(true)
  })

  it('reports an unknown model when no record matches', async () => {
    const service = new KeyboardServiceImpl({
      backend: new HidBackend(fakeSource()),
      snapshots: new SnapshotStore(await makeTempDir()),
    })
    expect((await service.status()).connection).toBe('unknown-model')
  })

  it('reports an open failure as disconnected with the reason', async () => {
    const source = fakeSource()
    source.openError = new Error('EACCES: permission denied')
    const service = new KeyboardServiceImpl({
      backend: new HidBackend(source),
      snapshots: new SnapshotStore(await makeTempDir()),
    })
    const status = await service.status()
    expect(status.connection).toBe('disconnected')
    expect(status.writeDisabledReasons.join(' ')).toMatch(/EACCES/)
    await expectServiceError(service.getConfig(), 'device-error')
  })
})

describe('loadModelRecords', () => {
  it('loads valid records from a file and skips malformed ones', async () => {
    const file = join(await makeTempDir(), 'models.json')
    await writeFile(file, JSON.stringify([{ ModelID: 7, Name: 'A', extra: 1 }, { ModelID: 'x' }, null, { Name: 'no id' }]))
    expect(await loadModelRecords(file)).toEqual([{ ModelID: 7, Name: 'A' }])
  })

  it('rejects a file that is not an array', async () => {
    const file = join(await makeTempDir(), 'models.json')
    await writeFile(file, '{}')
    await expect(loadModelRecords(file)).rejects.toThrow(/array/)
  })
})
