import type { Hono } from 'hono'
import { FileConfigStateStore, HidBackend, MockBackend, loadModelFile, type DeviceBackend } from './backend/index.js'
import type { DaemonConfig } from './config.js'
import { createHttpApp } from './http/app.js'
import { KeyboardServiceImpl } from './service/keyboard-service.js'
import { SnapshotStore } from './service/snapshot-store.js'
import { HidrawTransport } from './transport/hidraw.js'

export interface Daemon {
  app: Hono
  service: KeyboardServiceImpl
  backend: DeviceBackend
  close(): Promise<void>
}

async function createBackend(config: DaemonConfig): Promise<DeviceBackend> {
  if (config.backend === 'mock') return new MockBackend()
  const file = config.modelsFile === undefined ? undefined : await loadModelFile(config.modelsFile)
  // The hidraw device is only opened on the first request that needs it.
  return new HidBackend(new HidrawTransport(), {
    models: file?.records ?? [],
    ...(file === undefined ? {} : { keyIndexes: file.keyIndexes }),
    allowWrites: config.allowWrites,
    stateStore: new FileConfigStateStore(config.stateDir),
  })
}

/**
 * Wires backend, service and the HTTP/MCP app. Does not listen. Tests pass `backend` to run
 * against a `MockBackend` they control.
 */
export async function createDaemon(config: DaemonConfig, overrides: { backend?: DeviceBackend } = {}): Promise<Daemon> {
  const backend = overrides.backend ?? (await createBackend(config))
  const service = new KeyboardServiceImpl({
    backend,
    snapshots: new SnapshotStore(config.stateDir),
    allowWrites: config.allowWrites,
  })
  const app = createHttpApp({ service, port: config.port, allowedOrigins: config.allowedOrigins })
  return { app, service, backend, close: () => backend.close() }
}
