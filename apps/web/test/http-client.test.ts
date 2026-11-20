import { describe, expect, it, vi } from 'vitest'
import { ApiError, describeApiError } from '../src/api/client'
import { HttpApiClient } from '../src/api/http-client'
import { selectApiClient } from '../src/api/select'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('HttpApiClient', () => {
  it('maps ApiErrorBody to ApiError with a visible message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'plan-stale', message: 'revision moved' } }, 409),
    ) as unknown as typeof fetch
    const api = new HttpApiClient('http://127.0.0.1:6465/', fetchImpl)
    const error = await api.applyPlan('p1', { confirm: true }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'plan-stale', status: 409 })
    expect(describeApiError(error)).toContain('[plan-stale]')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:6465/api/plans/p1/apply',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true }) }),
    )
  })

  it('reports an unreachable daemon and a malformed body', async () => {
    const down = new HttpApiClient('http://x', (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch)
    await expect(down.status()).rejects.toMatchObject({ code: 'unreachable' })
    const bad = new HttpApiClient('http://x', (async () => new Response('<html>', { status: 502 })) as typeof fetch)
    await expect(bad.status()).rejects.toMatchObject({ code: 'bad-response', status: 502 })
  })
})

describe('selectApiClient', () => {
  it('uses the mock when forced or when the daemon is unreachable, with a reason', async () => {
    const forced = await selectApiClient({ env: { VITE_USE_MOCK: '1' }, search: '' })
    expect(forced.client.kind).toBe('mock')
    expect(forced.mockReason).toBe('VITE_USE_MOCK=1')
    const down = await selectApiClient({
      env: {},
      search: '?mock-mode=read-only',
      fetchImpl: (async () => {
        throw new TypeError('refused')
      }) as typeof fetch,
    })
    expect(down.client.kind).toBe('mock')
    expect(down.mockReason).toContain('unreachable')
    expect((await down.client.status()).mode).toBe('read-only')
  })

  it('uses the daemon when it answers, and does not hide a daemon error behind mock data', async () => {
    const ok = await selectApiClient({ env: {}, fetchImpl: (async () => jsonResponse({ mode: 'read-only' })) as unknown as typeof fetch })
    expect(ok.client.kind).toBe('http')
    const forbidden = await selectApiClient({
      env: {},
      fetchImpl: (async () => jsonResponse({ error: { code: 'forbidden-origin', message: 'no' } }, 403)) as unknown as typeof fetch,
    })
    expect(forbidden.client.kind).toBe('http')
    expect(forbidden.mockReason).toBeUndefined()
  })
})
