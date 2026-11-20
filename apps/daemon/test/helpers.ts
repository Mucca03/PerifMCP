import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { KeyboardServiceError } from '@perifmcp/core'
import type { ServiceErrorCode } from '@perifmcp/core'
import { MockBackend, type MockBackendOptions } from '../src/backend/index.js'
import { PlanStore, type PlanStoreOptions } from '../src/service/plan-store.js'
import { KeyboardServiceImpl } from '../src/service/keyboard-service.js'
import { SnapshotStore } from '../src/service/snapshot-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

export async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'perifmcp-test-'))
  tempDirs.push(dir)
  return dir
}

export interface TestRig {
  backend: MockBackend
  service: KeyboardServiceImpl
  snapshots: SnapshotStore
  plans: PlanStore
  stateDir: string
}

export interface RigOptions {
  allowWrites?: boolean
  backend?: MockBackendOptions
  plans?: PlanStoreOptions
  /** Use this directory instead of a fresh temp dir. */
  stateDir?: string
}

/** Service on a `MockBackend` and a temp snapshot folder. Never touches hardware or `profiles/`. */
export async function makeRig(options: RigOptions = {}): Promise<TestRig> {
  const stateDir = options.stateDir ?? (await makeTempDir())
  const backend = new MockBackend(options.backend)
  const snapshots = new SnapshotStore(stateDir)
  const plans = new PlanStore(options.plans)
  const service = new KeyboardServiceImpl({
    backend,
    snapshots,
    plans,
    allowWrites: options.allowWrites ?? false,
  })
  return { backend, service, snapshots, plans, stateDir }
}

export async function expectServiceError(promise: Promise<unknown>, code: ServiceErrorCode): Promise<KeyboardServiceError> {
  try {
    await promise
  } catch (error) {
    if (!(error instanceof KeyboardServiceError)) throw error
    if (error.code !== code) throw new Error(`expected service error ${code}, got ${error.code}: ${error.message}`)
    return error
  }
  throw new Error(`expected service error ${code}, but the call succeeded`)
}
