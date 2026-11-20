import { ApiError, type ApiClient } from './client'
import { DEFAULT_DAEMON_URL, HttpApiClient } from './http-client'
import { MockApiClient } from './mock-client'
import type { AccessMode } from '@perifmcp/core'

export interface ClientSelection {
  client: ApiClient
  /** Set when the mock is used. Shown in the "mock data" badge. */
  mockReason?: string
}

export interface SelectOptions {
  env?: { VITE_DAEMON_URL?: string | undefined; VITE_USE_MOCK?: string | undefined }
  search?: string
  fetchImpl?: typeof fetch
  probeTimeoutMs?: number
}

function mockMode(search: string): AccessMode {
  return new URLSearchParams(search).get('mock-mode') === 'read-only' ? 'read-only' : 'read-write'
}

/**
 * `VITE_USE_MOCK=1` forces the mock. Otherwise try the daemon once with a short timeout and fall back
 * to the mock when it does not answer. Open the UI with `?mock-mode=read-only` to see the read-only state.
 */
export async function selectApiClient(options: SelectOptions = {}): Promise<ClientSelection> {
  const env = options.env ?? import.meta.env
  const search = options.search ?? window.location.search
  if (env.VITE_USE_MOCK === '1') {
    return { client: new MockApiClient({ mode: mockMode(search) }), mockReason: 'VITE_USE_MOCK=1' }
  }
  const url = env.VITE_DAEMON_URL || DEFAULT_DAEMON_URL
  const http = new HttpApiClient(url, options.fetchImpl)
  try {
    await http.probe(options.probeTimeoutMs ?? 1500)
    return { client: http }
  } catch (error) {
    // A daemon that answers with an error (for example `forbidden-origin`) is reachable. Show its error, do not hide it behind mock data.
    if (error instanceof ApiError && error.code !== 'unreachable') return { client: http }
    const reason = error instanceof Error ? error.message : String(error)
    return {
      client: new MockApiClient({ mode: mockMode(search) }),
      mockReason: `daemon unreachable at startup (${reason})`,
    }
  }
}
