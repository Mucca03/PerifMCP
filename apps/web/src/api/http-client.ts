import type { ApiErrorBody } from '@perifmcp/core'
import { ApiError, type ApiClient } from './client'

export const DEFAULT_DAEMON_URL = 'http://127.0.0.1:6465'

type FetchLike = typeof fetch

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error: unknown }).error
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

export class HttpApiClient implements ApiClient {
  readonly kind = 'http' as const
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(baseUrl: string = DEFAULT_DAEMON_URL, fetchImpl: FetchLike = (...args) => fetch(...args)) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response
    try {
      const init: RequestInit = {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      }
      if (body !== undefined) init.body = JSON.stringify(body)
      if (signal) init.signal = signal
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new ApiError('unreachable', `${this.baseUrl}: ${reason}`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ApiError('bad-response', `HTTP ${response.status} without a JSON body.`, response.status)
    }

    if (!response.ok) {
      if (isErrorBody(payload)) {
        throw new ApiError(payload.error.code, payload.error.message, response.status, payload.error.details)
      }
      throw new ApiError('bad-response', `HTTP ${response.status} with an unexpected body.`, response.status)
    }
    return payload as T
  }

  /** Used at startup to decide between the daemon and the mock. */
  probe(timeoutMs: number): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    return this.request('GET', '/api/status', undefined, controller.signal).finally(() => clearTimeout(timer))
  }

  status: ApiClient['status'] = () => this.request('GET', '/api/status')
  layout: ApiClient['layout'] = () => this.request('GET', '/api/layout')
  config: ApiClient['config'] = () => this.request('GET', '/api/config')
  macros: ApiClient['macros'] = () => this.request('GET', '/api/macros')
  lighting: ApiClient['lighting'] = () => this.request('GET', '/api/lighting')

  planKeys: ApiClient['planKeys'] = (body) => this.request('POST', '/api/plans/keys', body)
  planMacro: ApiClient['planMacro'] = (body) => this.request('POST', '/api/plans/macro', body)
  planLighting: ApiClient['planLighting'] = (body) => this.request('POST', '/api/plans/lighting', body)
  listPlans: ApiClient['listPlans'] = () => this.request('GET', '/api/plans')
  previewPlan: ApiClient['previewPlan'] = (id) => this.request('GET', `/api/plans/${encodeURIComponent(id)}/preview`)
  applyPlan: ApiClient['applyPlan'] = (id, body) =>
    this.request('POST', `/api/plans/${encodeURIComponent(id)}/apply`, body)

  verify: ApiClient['verify'] = () => this.request('POST', '/api/verify')

  listSnapshots: ApiClient['listSnapshots'] = () => this.request('GET', '/api/snapshots')
  createSnapshot: ApiClient['createSnapshot'] = (body) => this.request('POST', '/api/snapshots', body)
  restoreSnapshot: ApiClient['restoreSnapshot'] = (id, body) =>
    this.request('POST', `/api/snapshots/${encodeURIComponent(id)}/restore`, body)
}
