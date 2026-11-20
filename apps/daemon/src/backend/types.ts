import type { ConfigChange, DeviceInfo, KeyboardConfig } from '@perifmcp/core'

/**
 * Everything the service needs from a keyboard. Internal to the daemon, not a core contract.
 * The service never sees a packet: a backend turns semantic configs and changes into whatever
 * the transport needs.
 */
export interface DeviceBackend {
  readonly transport: 'hidraw' | 'mock'
  /** False until the protocol encoders exist and the master enables writes. */
  readonly supportsWrites: boolean
  /** `undefined` when no keyboard is connected. Throws if a connected keyboard cannot be queried. */
  identify(): Promise<DeviceInfo | undefined>
  readConfig(): Promise<KeyboardConfig>
  /** Applies only the given changes. Must throw `write-disabled` when `supportsWrites` is false. */
  writeChanges(changes: ConfigChange[]): Promise<void>
  close(): Promise<void>
}
