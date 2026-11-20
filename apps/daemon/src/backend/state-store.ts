import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LAYERS, cloneConfig, validateChange } from '@perifmcp/core'
import type { ConfigChange, KeyboardConfig } from '@perifmcp/core'

/**
 * Remembers the last configuration written to a keyboard that cannot be read back.
 * Keyed by model id, because the device id of these keyboards is all ones for every unit.
 */
export interface ConfigStateStore {
  /** `undefined` when nothing was saved, or when the saved file is not a valid configuration. */
  load(modelId: number): Promise<KeyboardConfig | undefined>
  save(modelId: number, config: KeyboardConfig): Promise<void>
}

interface StateFile {
  version: 1
  savedAt: string
  modelId: number
  config: KeyboardConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks a parsed file with the same validators the encoders rely on. Returns the config, or
 * `undefined` for anything that does not pass, so a damaged or hand-edited file can never reach a write.
 */
export function parseStateConfig(value: unknown): KeyboardConfig | undefined {
  if (!isRecord(value) || !isRecord(value.layers) || !Array.isArray(value.macros)) return undefined
  if (!isRecord(value.lighting) || !isRecord(value.settings)) return undefined
  const config = value as unknown as KeyboardConfig

  const changes: ConfigChange[] = [
    { type: 'set-lighting', lighting: config.lighting },
    { type: 'set-settings', settings: config.settings },
  ]
  for (const macro of config.macros) changes.push({ type: 'set-macro', macro })
  for (const layer of LAYERS) {
    const entries = config.layers[layer]
    if (!isRecord(entries)) return undefined
    for (const [keyId, assignment] of Object.entries(entries)) {
      changes.push({ type: 'set-key', layer, keyId, assignment })
    }
  }
  try {
    return changes.every((change) => validateChange(change).length === 0) ? cloneConfig(config) : undefined
  } catch {
    return undefined
  }
}

/** One JSON file per model under `<stateDir>/state/`. Written atomically, readable only by the owner. */
export class FileConfigStateStore implements ConfigStateStore {
  constructor(private readonly stateDir: string) {}

  private pathFor(modelId: number): string {
    if (!Number.isSafeInteger(modelId) || modelId < 0) throw new RangeError('modelId must be a non-negative integer')
    return join(this.stateDir, 'state', `${modelId}.json`)
  }

  async load(modelId: number): Promise<KeyboardConfig | undefined> {
    let text: string
    try {
      text = await readFile(this.pathFor(modelId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isRecord(parsed) || parsed.version !== 1 || parsed.modelId !== modelId) return undefined
      return parseStateConfig(parsed.config)
    } catch {
      return undefined
    }
  }

  async save(modelId: number, config: KeyboardConfig): Promise<void> {
    const file = this.pathFor(modelId)
    const body: StateFile = { version: 1, savedAt: new Date().toISOString(), modelId, config }
    await mkdir(join(this.stateDir, 'state'), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }
}
