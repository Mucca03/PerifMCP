import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, buildPacket, createDefaultConfig, isCommandAllowed } from '@perifmcp/core'
import type { ConfigChange, DeviceSummary, HidConnection, KeyIndexMap } from '@perifmcp/core'
import {
  FileConfigStateStore,
  HidBackend,
  assumedFirmwareConfig,
  loadModelFile,
  loadModelRecords,
  type VendorInterfaceSource,
} from '../src/backend/index.js'
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

const MODEL = { ModelID: 0x1234, Name: 'Test Model' }

/** Synthetic codes for the real layout keys. The real map is local model data and never in the repo. */
function syntheticKeyIndex(): KeyIndexMap {
  const logic: Record<string, number> = {}
  const location: Record<string, number> = {}
  DEFAULT_LAYOUT.keys.forEach((key, index) => {
    logic[key.id] = index
    location[key.id] = index
  })
  return { logicSize: 112, logic, location }
}

const KEY_INDEXES: ReadonlyMap<number, KeyIndexMap> = new Map([[0x1234, syntheticKeyIndex()]])

const LIGHT_ESC: ConfigChange[] = [
  {
    type: 'set-lighting',
    lighting: {
      ...createDefaultConfig().lighting,
      enabled: true,
      effect: 'per-key',
      perKey: { escape: { r: 134, g: 239, b: 172 } },
    },
  },
]

describe('HidBackend saved configuration', () => {
  it('reports where the configuration comes from', async () => {
    const dir = await makeTempDir()
    const options = { models: [MODEL], keyIndexes: KEY_INDEXES, allowWrites: true, stateStore: new FileConfigStateStore(dir) }

    const first = new HidBackend(fakeSource(), options)
    await first.identify()
    expect(first.configSource()).toBe('assumed-default')
    await first.writeChanges(LIGHT_ESC)
    expect(first.configSource()).toBe('last-written')
    await first.close()

    // A new process: the saved configuration comes back, so the lighting is not "assumed off" any more.
    const second = new HidBackend(fakeSource(), options)
    await second.identify()
    expect(second.configSource()).toBe('last-written')
    const restored = await second.readConfig()
    expect(restored.lighting.effect).toBe('per-key')
    expect(restored.lighting.perKey.escape).toEqual({ r: 134, g: 239, b: 172 })
  })

  it('keeps the saved file private and ignores one that is damaged or invalid', async () => {
    const dir = await makeTempDir()
    const store = new FileConfigStateStore(dir)
    const config = createDefaultConfig()
    await store.save(0x1234, config)
    const file = join(dir, 'state', `${0x1234}.json`)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await store.load(0x1234)).toEqual(config)
    expect(await store.load(0x9999)).toBeUndefined()

    await writeFile(file, '{ not json')
    expect(await store.load(0x1234)).toBeUndefined()

    const invalid = createDefaultConfig()
    invalid.lighting.brightness = 500
    await writeFile(file, JSON.stringify({ version: 1, savedAt: 'x', modelId: 0x1234, config: invalid }))
    expect(await store.load(0x1234)).toBeUndefined()

    // A file saved for another model is not used.
    await writeFile(file, JSON.stringify({ version: 1, savedAt: 'x', modelId: 7, config }))
    expect(await store.load(0x1234)).toBeUndefined()
  })

  it('reports a read-only start without a state store as assumed defaults', async () => {
    const backend = new HidBackend(fakeSource(), { models: [MODEL] })
    await backend.identify()
    expect(backend.configSource()).toBe('assumed-default')
  })
})

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

  it('stays read-only without allowWrites and returns the assumed default config', async () => {
    const source = fakeSource()
    const backend = new HidBackend(source, { models: [MODEL], keyIndexes: KEY_INDEXES })
    expect(backend.supportsWrites).toBe(false)
    expect(backend.readsBack).toBe(false)
    await backend.identify()
    expect(backend.supportsWrites).toBe(false)
    await expectServiceError(
      backend.writeChanges([{ type: 'set-settings', settings: { nkro: true, osMode: 'win' } }]),
      'write-disabled',
    )
    expect(await backend.readConfig()).toEqual(assumedFirmwareConfig())
    expect(Object.keys((await backend.readConfig()).layers.base)).toEqual([])
    expect(source.sent.every((item) => isCommandAllowed('read-only', item.command, item.subCommand))).toBe(true)
  })

  it('does not enable writes for a model without a key index map', async () => {
    const source = fakeSource()
    const backend = new HidBackend(source, { models: [MODEL], allowWrites: true })
    await backend.identify()
    expect(backend.supportsWrites).toBe(false)
    expect(backend.writeBlocker()).toMatch(/PERIFMCP_MODELS_FILE/)
    await expectServiceError(backend.writeChanges(LIGHT_ESC), 'write-disabled')
  })

  it('reports the missing read-back reason in the service status', async () => {
    const service = new KeyboardServiceImpl({
      backend: new HidBackend(fakeSource(), { models: [MODEL], allowWrites: true }),
      snapshots: new SnapshotStore(await makeTempDir()),
      allowWrites: true,
    })
    const status = await service.status()
    expect(status.writeEnabled).toBe(false)
    expect(status.writeDisabledReasons.join(' ')).toMatch(/key index map/)
    expect(status.device?.serialNumber).toBeUndefined()
    await expectServiceError(service.applyPlan('x', true), 'write-disabled')
  })

  it('writes lighting after a snapshot and never claims it was verified', async () => {
    const source = fakeSource()
    const snapshots = new SnapshotStore(await makeTempDir())
    const service = new KeyboardServiceImpl({
      backend: new HidBackend(source, { models: [MODEL], keyIndexes: KEY_INDEXES, allowWrites: true }),
      snapshots,
      allowWrites: true,
    })

    const status = await service.status()
    expect(status.writeEnabled).toBe(true)
    expect(status.configRevision).not.toBe('unavailable')

    const plan = await service.planLighting({ perKey: { escape: '#86efac' } })
    const result = await service.applyPlan(plan.id, true)

    expect(result.applied).toBe(true)
    expect(result.verified).toBe(false)
    expect(result.errors.join(' ')).toMatch(/no read-back command/)
    expect(result.snapshotId).toBeDefined()
    expect((await service.listSnapshots()).map((item) => item.id)).toContain(result.snapshotId)

    const commands = source.sent.map((item) => item.command)
    expect(commands).toContain(0x27)
    // Only lighting and the refresh are written for a lighting plan. No key table, no restart, no USB identity.
    expect(commands).not.toContain(0x22)
    expect(commands).not.toContain(0x03)
    expect(commands).not.toContain(0x41)
    // Snapshot data first: the first non-identification command comes after the last read-only one.
    const firstWrite = source.sent.findIndex((item) => !isCommandAllowed('read-only', item.command, item.subCommand))
    expect(firstWrite).toBeGreaterThan(0)

    const verify = await service.verify()
    expect(verify.ok).toBe(false)
    expect(verify.mismatches[0]?.description).toMatch(/no read-back command/)
  })

  it('refuses a lighting effect it cannot encode, without sending a write', async () => {
    const source = fakeSource()
    const service = new KeyboardServiceImpl({
      backend: new HidBackend(source, { models: [MODEL], keyIndexes: KEY_INDEXES, allowWrites: true }),
      snapshots: new SnapshotStore(await makeTempDir()),
      allowWrites: true,
    })
    const plan = await service.planLighting({ effect: 'breathing', color: '#86efac' })
    const result = await service.applyPlan(plan.id, true)
    expect(result.applied).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Cannot write yet.*breathing/)
    expect(source.sent.every((item) => isCommandAllowed('read-only', item.command, item.subCommand))).toBe(true)
  })

  it('loads and validates the key index of a model file', async () => {
    const dir = await makeTempDir()
    const good = join(dir, 'models.json')
    await writeFile(good, JSON.stringify([{ ModelID: 7, Name: 'M', KeyIndex: KEY_INDEXES.get(0x1234) }]))
    const loaded = await loadModelFile(good)
    expect(loaded.records.map((record) => record.ModelID)).toEqual([7])
    expect(loaded.keyIndexes.get(7)?.logicSize).toBe(112)

    const bad = join(dir, 'bad.json')
    await writeFile(bad, JSON.stringify([{ ModelID: 7, KeyIndex: { logicSize: 4, logic: { a: 1, b: 1 }, location: {} } }]))
    await expect(loadModelFile(bad)).rejects.toThrow(/Invalid KeyIndex/)
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
