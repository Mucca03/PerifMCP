import { fileURLToPath } from 'node:url'
import { DEFAULT_DAEMON_PORT } from '@perifmcp/core'

export const DAEMON_HOST = '127.0.0.1'
export const DEFAULT_ALLOWED_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'] as const

export interface DaemonConfig {
  /** Always 127.0.0.1. Not configurable. */
  host: typeof DAEMON_HOST
  port: number
  /** Browser origins allowed to call the API (exact match, no wildcard). */
  allowedOrigins: string[]
  /** Root of the snapshot folders. Defaults to `profiles/local/` in the repo (gitignored). */
  stateDir: string
  /** `PERIFMCP_ALLOW_WRITES=1`. Read here, never set by the daemon. */
  allowWrites: boolean
  backend: 'mock' | 'hid'
  /** Optional JSON file with model records, supplied by the operator. Never committed. */
  modelsFile: string | undefined
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_DAEMON_PORT
  if (!/^\d{1,5}$/.test(value)) throw new ConfigError('PERIFMCP_PORT must be an integer from 1 to 65535')
  const port = Number(value)
  if (port < 1 || port > 65535) throw new ConfigError('PERIFMCP_PORT must be an integer from 1 to 65535')
  return port
}

export function parseOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [...DEFAULT_ALLOWED_ORIGINS]
  const origins: string[] = []
  for (const item of value.split(',')) {
    const text = item.trim()
    if (text === '') continue
    let url: URL
    try {
      url = new URL(text)
    } catch {
      throw new ConfigError(`PERIFMCP_ALLOWED_ORIGINS: "${text}" is not a valid origin`)
    }
    if (text.includes('*') || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== text.replace(/\/$/, '')) {
      throw new ConfigError(`PERIFMCP_ALLOWED_ORIGINS: "${text}" must look like http://host:port (no path, no wildcard)`)
    }
    origins.push(url.origin)
  }
  return origins
}

export function defaultStateDir(): string {
  // apps/daemon/src/config.ts -> <repo>/profiles/local
  return fileURLToPath(new URL('../../../profiles/local', import.meta.url))
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const backend = env.PERIFMCP_BACKEND ?? 'mock'
  if (backend !== 'mock' && backend !== 'hid') throw new ConfigError('PERIFMCP_BACKEND must be "mock" or "hid"')
  return {
    host: DAEMON_HOST,
    port: parsePort(env.PERIFMCP_PORT),
    allowedOrigins: parseOrigins(env.PERIFMCP_ALLOWED_ORIGINS),
    stateDir: env.PERIFMCP_STATE_DIR && env.PERIFMCP_STATE_DIR !== '' ? env.PERIFMCP_STATE_DIR : defaultStateDir(),
    allowWrites: env.PERIFMCP_ALLOW_WRITES === '1',
    backend,
    modelsFile: env.PERIFMCP_MODELS_FILE && env.PERIFMCP_MODELS_FILE !== '' ? env.PERIFMCP_MODELS_FILE : undefined,
  }
}
