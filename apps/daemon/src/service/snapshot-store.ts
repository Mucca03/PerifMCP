import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { KeyboardServiceError, LAYERS } from '@perifmcp/core'
import type { KeyboardConfig, Snapshot, SnapshotMeta } from '@perifmcp/core'

const SNAPSHOT_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/

/** Directory name for a device. Device ids come from the keyboard, but are still sanitized. */
export function deviceDirName(deviceId: string): string {
  const cleaned = deviceId
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeConfig(value: unknown): value is KeyboardConfig {
  if (!isRecord(value)) return false
  const { layers, macros, lighting, settings } = value
  if (!isRecord(layers) || !LAYERS.every((layer) => isRecord(layers[layer]))) return false
  return (
    Array.isArray(macros) &&
    isRecord(lighting) &&
    isRecord(lighting.perKey) &&
    isRecord(lighting.color) &&
    isRecord(settings)
  )
}

function looksLikeSnapshot(value: unknown): value is Snapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.deviceId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.reason === 'string' &&
    (value.planId === undefined || typeof value.planId === 'string') &&
    looksLikeConfig(value.config)
  )
}

function toMeta(snapshot: Snapshot): SnapshotMeta {
  return {
    id: snapshot.id,
    deviceId: snapshot.deviceId,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    ...(snapshot.planId === undefined ? {} : { planId: snapshot.planId }),
  }
}

/**
 * Snapshots as JSON files under `<root>/<deviceId>/<uuid>.json` (root is gitignored).
 * Ids are generated here. A client-supplied id is only ever compared with names read from the
 * directory, never joined into a path.
 */
export class SnapshotStore {
  private lastTime = 0

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  async save(deviceId: string, config: KeyboardConfig, reason: string, planId?: string): Promise<SnapshotMeta> {
    const directory = join(this.root, deviceDirName(deviceId))
    await mkdir(directory, { recursive: true, mode: 0o700 })

    // Strictly increasing timestamps keep "newest first" stable when two snapshots land in the same millisecond.
    this.lastTime = Math.max(this.now(), this.lastTime + 1)
    const snapshot: Snapshot = {
      id: randomUUID(),
      deviceId,
      createdAt: new Date(this.lastTime).toISOString(),
      reason,
      ...(planId === undefined ? {} : { planId }),
      config: structuredClone(config),
    }

    const target = join(directory, `${snapshot.id}.json`)
    const temporary = join(directory, `.${snapshot.id}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' })
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    return toMeta(snapshot)
  }

  async list(deviceId: string): Promise<SnapshotMeta[]> {
    const snapshots = await this.readAll(deviceId)
    return snapshots.map(toMeta)
  }

  async load(deviceId: string, snapshotId: string): Promise<Snapshot> {
    const entries = await this.entries(deviceId)
    const match = entries.find((name) => name === `${snapshotId}.json`)
    if (match === undefined) {
      throw new KeyboardServiceError('snapshot-not-found', 'Snapshot not found')
    }
    const snapshot = await this.readFile(deviceId, match)
    if (snapshot === undefined || snapshot.id !== snapshotId) {
      throw new KeyboardServiceError('snapshot-not-found', 'Snapshot file is unreadable')
    }
    return snapshot
  }

  private async entries(deviceId: string): Promise<string[]> {
    try {
      const names = await readdir(join(this.root, deviceDirName(deviceId)))
      return names.filter((name) => SNAPSHOT_FILE_RE.test(name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async readFile(deviceId: string, name: string): Promise<Snapshot | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.root, deviceDirName(deviceId), name), 'utf8'))
      return looksLikeSnapshot(parsed) && parsed.deviceId === deviceId ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private async readAll(deviceId: string): Promise<Snapshot[]> {
    const snapshots: Snapshot[] = []
    for (const name of await this.entries(deviceId)) {
      const snapshot = await this.readFile(deviceId, name)
      if (snapshot !== undefined && `${snapshot.id}.json` === name) snapshots.push(snapshot)
    }
    return snapshots.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }
}
