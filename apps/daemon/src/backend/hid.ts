import { readFile } from 'node:fs/promises'
import { Gk6xClient, KeyboardServiceError, guardConnection } from '@perifmcp/core'
import type {
  ConfigChange,
  DeviceInfo,
  DeviceSummary,
  HidConnection,
  KeyboardConfig,
  ModelRecord,
} from '@perifmcp/core'
import type { DeviceBackend } from './types.js'

/** What `HidrawTransport` offers. Tests pass a fake, so no test opens `/dev/hidraw*`. */
export interface VendorInterfaceSource {
  list(): Promise<DeviceSummary[]>
  openVendorInterface(): Promise<HidConnection>
}

export interface HidBackendOptions {
  /** Model records loaded at runtime. Without a match for the device the model is unknown. */
  models?: ModelRecord[]
}

interface Session {
  client: Gk6xClient
  info: DeviceInfo
}

/**
 * Read-only backend for the real keyboard. The connection is always wrapped with
 * `guardConnection` in `read-only` mode, so only identification commands can leave the process.
 * Opened lazily on the first `identify()`.
 *
 * Depends on protocol phase 2: `readConfig` needs the decoders and `writeChanges` the encoders.
 */
export class HidBackend implements DeviceBackend {
  readonly transport = 'hidraw' as const
  readonly supportsWrites = false

  private session: Session | undefined
  private queue: Promise<unknown> = Promise.resolve()

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

      const connection = guardConnection(await this.source.openVendorInterface(), { mode: 'read-only' })
      const client = new Gk6xClient(connection, { models: this.options.models ?? [] })
      try {
        await client.ping()
        const info = await client.info()
        this.session = { client, info }
        return info
      } catch (error) {
        await client.close().catch(() => undefined)
        throw error
      }
    })
  }

  async readConfig(): Promise<KeyboardConfig> {
    throw new KeyboardServiceError(
      'device-error',
      'Reading the key configuration from the keyboard is not implemented yet (needs protocol decoders)',
    )
  }

  async writeChanges(_changes: ConfigChange[]): Promise<void> {
    throw new KeyboardServiceError('write-disabled', 'The hidraw backend is read-only')
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
