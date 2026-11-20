import { readFile } from 'node:fs/promises'
import { Gk6xClient, KeyboardServiceError, cloneConfig, createDefaultConfig, encodeChanges, guardConnection, validateKeyIndexMap } from '@perifmcp/core'
import type {
  ConfigChange,
  ConfigSource,
  KeyIndexMap,
  DeviceInfo,
  DeviceSummary,
  HidConnection,
  KeyboardConfig,
  ModelRecord,
} from '@perifmcp/core'
import type { ConfigStateStore } from './state-store.js'
import type { DeviceBackend } from './types.js'

/** What `HidrawTransport` offers. Tests pass a fake, so no test opens `/dev/hidraw*`. */
export interface VendorInterfaceSource {
  list(): Promise<DeviceSummary[]>
  openVendorInterface(): Promise<HidConnection>
}

export interface HidBackendOptions {
  /** Model records loaded at runtime. Without a match for the device the model is unknown. */
  models?: ModelRecord[]
  /** Key index maps by model id, loaded at runtime. A model without one cannot be written. */
  keyIndexes?: ReadonlyMap<number, KeyIndexMap>
  /** `PERIFMCP_ALLOW_WRITES=1`. Without it the connection never leaves `read-only`. */
  allowWrites?: boolean
  /** Remembers the last written configuration across restarts. Without it every start assumes the defaults. */
  stateStore?: ConfigStateStore
}

interface Session {
  /** Read-only client. Always present. */
  client: Gk6xClient
  /** Read-write client over the same connection. Only when writes are allowed and the model is mapped. */
  writer: Gk6xClient | undefined
  keyIndex: KeyIndexMap | undefined
  info: DeviceInfo
}

/**
 * What this process assumes the keyboard holds at start. Every key table entry is `none`, which the encoder
 * writes as `0xFFFFFFFF`: "use what the firmware defines". The reference tool's `map` and `unmap` commands do
 * the same for every key the user did not set, so writing a table built from this config changes only the keys
 * a plan names, and writing it back with those keys set to `none` returns to the firmware defaults.
 */
export function assumedFirmwareConfig(): KeyboardConfig {
  const config = createDefaultConfig()
  config.layers.base = {}
  return config
}

/**
 * Backend for the real keyboard.
 *
 * Every connection is wrapped with `guardConnection`. Identification uses a `read-only` guard, so only
 * `0x01` and `0x0c` can leave the process. A `read-write` guard over the same connection exists only when
 * `allowWrites` is set and the identified model has a key index map. Restart (`0x03`) and the USB identity
 * change (`0x41`) are blocked in both modes.
 *
 * The keyboard has no command to read keys, macros or lighting. `readConfig` therefore returns a shadow:
 * the factory default this process assumes at start, plus every change written since. It is not a read of
 * the device, so `readsBack` is false and `verified` can never be true. With a `stateStore` the shadow also
 * survives restarts: it is saved after every successful write and loaded when the model is identified.
 *
 * Opened lazily on the first `identify()`.
 */
export class HidBackend implements DeviceBackend {
  readonly transport = 'hidraw' as const
  readonly readsBack = false

  private session: Session | undefined
  private shadow: KeyboardConfig = assumedFirmwareConfig()
  private configOrigin: ConfigSource = 'assumed-default'
  private restored = false
  private queue: Promise<unknown> = Promise.resolve()

  configSource(): ConfigSource {
    return this.configOrigin
  }

  get supportsWrites(): boolean {
    return this.session?.writer !== undefined
  }

  writeBlocker(): string | undefined {
    if (this.options.allowWrites !== true) return undefined
    const session = this.session
    if (session === undefined) return 'No keyboard session is open'
    if (session.keyIndex === undefined) {
      return `No key index map for model ${session.info.modelId ?? 'unknown'} (set PERIFMCP_MODELS_FILE)`
    }
    return undefined
  }

  constructor(
    private readonly source: VendorInterfaceSource,
    private readonly options: HidBackendOptions = {},
  ) {}

  identify(): Promise<DeviceInfo | undefined> {
    return this.serial(async () => {
      const devices = await this.source.list()
      if (devices.length === 0) {
        await this.dropSession()
        return undefined
      }
      if (this.session) return this.session.info

      const raw = await this.source.openVendorInterface()
      const client = new Gk6xClient(guardConnection(raw, { mode: 'read-only' }), { models: this.options.models ?? [] })
      try {
        // The reference tool sends ping without waiting for a reply, so a missing reply is not fatal.
        await client.ping(1500).catch(() => undefined)
        const info = await client.info()
        const keyIndex = info.modelId === undefined ? undefined : this.options.keyIndexes?.get(info.modelId)
        const mayWrite = this.options.allowWrites === true && info.modelName !== undefined && keyIndex !== undefined
        const writer = mayWrite ? new Gk6xClient(guardConnection(raw, { mode: 'read-write' })) : undefined
        this.session = { client, writer, keyIndex, info }
        await this.restoreShadow(info.modelId)
        return info
      } catch (error) {
        await client.close().catch(() => undefined)
        throw error
      }
    })
  }

  async readConfig(): Promise<KeyboardConfig> {
    return cloneConfig(this.shadow)
  }

  writeChanges(changes: ConfigChange[]): Promise<void> {
    return this.serial(async () => {
      const session = this.session
      const writer = session?.writer
      if (session === undefined || writer === undefined || session.keyIndex === undefined) {
        throw new KeyboardServiceError('write-disabled', this.writeBlocker() ?? 'The hidraw backend is read-only')
      }

      const encoded = encodeChanges(this.shadow, changes, { keyIndex: session.keyIndex })
      if (encoded.errors.length > 0) {
        throw new KeyboardServiceError('validation', encoded.errors.join('; '), { errors: encoded.errors })
      }
      if (encoded.unsupported.length > 0) {
        throw new KeyboardServiceError('validation', `Cannot write yet: ${encoded.unsupported.join('; ')}`, {
          unsupported: encoded.unsupported,
        })
      }

      try {
        for (const step of encoded.steps) await writer.writePackets(step.packets)
      } catch (error) {
        // The keyboard may hold a half-written table. The shadow is kept as it was.
        throw new KeyboardServiceError(
          'device-error',
          `Write interrupted, the keyboard may be partly written: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      this.shadow = encoded.after
      this.configOrigin = 'last-written'
      await this.persistShadow(session.info.modelId)
    })
  }

  /** Loads the saved configuration once per process, the first time the model is known. */
  private async restoreShadow(modelId: number | undefined): Promise<void> {
    if (this.restored || modelId === undefined || this.options.stateStore === undefined) return
    this.restored = true
    try {
      const saved = await this.options.stateStore.load(modelId)
      if (saved !== undefined) {
        this.shadow = saved
        this.configOrigin = 'last-written'
      }
    } catch (error) {
      console.warn(`Could not load the saved configuration: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The keyboard already accepted the write, so a failed save is reported but does not fail the write. */
  private async persistShadow(modelId: number | undefined): Promise<void> {
    if (modelId === undefined || this.options.stateStore === undefined) return
    try {
      await this.options.stateStore.save(modelId, this.shadow)
    } catch (error) {
      console.warn(`Could not save the configuration: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  close(): Promise<void> {
    return this.serial(() => this.dropSession())
  }

  private async dropSession(): Promise<void> {
    const session = this.session
    this.session = undefined
    await session?.client.close().catch(() => undefined)
  }

  /** One command at a time on the shared HID channel. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }
}

/**
 * Loads model records from a JSON file the operator points to (`PERIFMCP_MODELS_FILE`).
 * Model data is never committed to the repo.
 */
export async function loadModelRecords(path: string): Promise<ModelRecord[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('Model file must contain a JSON array')
  const records: ModelRecord[] = []
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.ModelID !== 'number' || !Number.isInteger(record.ModelID)) continue
    records.push({
      ModelID: record.ModelID,
      ...(typeof record.Name === 'string' ? { Name: record.Name } : {}),
      ...(typeof record.FWID === 'string' ? { FWID: record.FWID } : {}),
      ...(typeof record.LEType === 'string' ? { LEType: record.LEType } : {}),
    })
  }
  return records
}

export interface ModelFile {
  records: ModelRecord[]
  keyIndexes: Map<number, KeyIndexMap>
}

/**
 * Loads `PERIFMCP_MODELS_FILE`: the model records plus the optional `KeyIndex` of each one
 * (`logicSize`, `logic`, `location`). The file is local, derived from vendor data and never committed.
 * A `KeyIndex` that fails `validateKeyIndexMap` is rejected, so a bad map cannot reach an encoder.
 */
export async function loadModelFile(path: string): Promise<ModelFile> {
  const records = await loadModelRecords(path)
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown[]
  const keyIndexes = new Map<number, KeyIndexMap>()
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.ModelID !== 'number' || record.KeyIndex === undefined) continue
    const index = record.KeyIndex as Record<string, unknown>
    const map: KeyIndexMap = {
      logicSize: typeof index.logicSize === 'number' ? index.logicSize : 0,
      logic: toCodeTable(index.logic),
      location: toCodeTable(index.location),
    }
    const errors = validateKeyIndexMap(map)
    if (errors.length > 0) throw new Error(`Invalid KeyIndex for model ${record.ModelID}: ${errors.join('; ')}`)
    keyIndexes.set(record.ModelID, map)
  }
  return { records, keyIndexes }
}

function toCodeTable(value: unknown): Record<string, number> {
  const table: Record<string, number> = {}
  if (typeof value !== 'object' || value === null) return table
  for (const [key, code] of Object.entries(value)) {
    if (typeof code === 'number') table[key] = code
  }
  return table
}
