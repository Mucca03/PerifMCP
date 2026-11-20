import type { DeviceSummary } from './types.js'

export interface HidConnection {
  readonly info: DeviceSummary
  send(packet: Uint8Array, timeoutMs?: number): Promise<Uint8Array>
  close(): Promise<void>
  subscribe?(listener: (packet: Uint8Array) => void): () => void
}

export interface HidTransport {
  readonly kind: 'hidraw' | 'mock'
  list(): Promise<DeviceSummary[]>
  open(deviceId: string): Promise<HidConnection>
}
