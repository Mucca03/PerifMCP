import type { ConfigChange, DeviceInfo, KeyboardConfig } from '@perifmcp/core'

/**
 * Everything the service needs from a keyboard. Internal to the daemon, not a core contract.
 * The service never sees a packet: a backend turns semantic configs and changes into whatever
 * the transport needs.
 */
export interface DeviceBackend {
  readonly transport: 'hidraw' | 'mock'
  /** False until writes are allowed and the model has what the encoders need. */
  readonly supportsWrites: boolean
  /**
   * True when `readConfig` reflects what the keyboard itself reports. The real GK6X keyboards have no
   * command to read keys, macros or lighting back, so the hidraw backend is false: its `readConfig` is the
   * last configuration this process wrote, on top of an assumed factory default.
   */
  readonly readsBack: boolean
  /** Why `supportsWrites` is false, when the backend knows. Shown in `status().writeDisabledReasons`. */
  writeBlocker?(): string | undefined
  /** `undefined` when no keyboard is connected. Throws if a connected keyboard cannot be queried. */
  identify(): Promise<DeviceInfo | undefined>
  readConfig(): Promise<KeyboardConfig>
  /** Applies only the given changes. Must throw `write-disabled` when `supportsWrites` is false. */
  writeChanges(changes: ConfigChange[]): Promise<void>
  close(): Promise<void>
}
