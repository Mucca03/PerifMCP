import { createDefaultConfig, KeyboardServiceError } from '@perifmcp/core'
import type { ConfigChange, DeviceInfo, KeyboardConfig } from '@perifmcp/core'
import { applyChanges } from '@perifmcp/core'
import type { DeviceBackend } from './types.js'

export interface MockBackendOptions {
  initialConfig?: KeyboardConfig
  /** Start without a keyboard. Default true. */
  connected?: boolean
  /** Report a model name. Without it the service treats the model as unknown. Default true. */
  modelKnown?: boolean
  /** Default true. */
  supportsWrites?: boolean
}

function defaultMockConfig(): KeyboardConfig {
  const config = createDefaultConfig()
  return config
}

/** In-memory keyboard for tests and development. Never touches hardware. */
export class MockBackend implements DeviceBackend {
  readonly transport = 'mock' as const
  supportsWrites: boolean
  connected: boolean
  modelKnown: boolean

  /** Every `writeChanges` call, in order. */
  readonly writes: ConfigChange[][] = []
  /** Fault injection: throw this on the next write. */
  failNextWrite: Error | undefined
  /** Fault injection: transform the config after a write, to simulate a device that stores something else. */
  tamper: ((config: KeyboardConfig) => KeyboardConfig) | undefined
  /** Fault injection: throw this from `readConfig`. */
  failReads: Error | undefined

  private config: KeyboardConfig

  constructor(options: MockBackendOptions = {}) {
    this.config = structuredClone(options.initialConfig ?? defaultMockConfig())
    this.connected = options.connected ?? true
    this.modelKnown = options.modelKnown ?? true
    this.supportsWrites = options.supportsWrites ?? true
  }

  async identify(): Promise<DeviceInfo | undefined> {
    if (!this.connected) return undefined
    return {
      vendorId: 0x1ea7,
      productId: 0x0907,
      manufacturer: 'mock',
      product: 'PerifMCP mock keyboard',
      transport: 'mock',
      deviceId: 'mock-gim-k64',
      ...(this.modelKnown ? { modelName: 'GIM K64 RGB (mock)' } : {}),
    }
  }

  async readConfig(): Promise<KeyboardConfig> {
    this.requireConnected()
    if (this.failReads) throw this.failReads
    return structuredClone(this.config)
  }

  async writeChanges(changes: ConfigChange[]): Promise<void> {
    this.requireConnected()
    if (!this.supportsWrites) {
      throw new KeyboardServiceError('write-disabled', 'The mock backend was created without write support')
    }
    this.writes.push(structuredClone(changes))
    if (this.failNextWrite) {
      const error = this.failNextWrite
      this.failNextWrite = undefined
      throw error
    }
    const next = applyChanges(this.config, changes)
    this.config = this.tamper ? this.tamper(next) : next
  }

  async close(): Promise<void> {}

  private requireConnected(): void {
    if (!this.connected) throw new KeyboardServiceError('not-connected', 'No keyboard is connected')
  }
}
