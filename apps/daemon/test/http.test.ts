import { describe, expect, it, vi } from 'vitest'
import { API_ERROR_STATUS } from '@perifmcp/core'
import type { ApiErrorBody, ConfigPlan, KeyboardService } from '@perifmcp/core'
import { createHttpApp } from '../src/http/app.js'
import { MAX_BODY_BYTES } from '../src/limits.js'
import { makeRig, type RigOptions } from './helpers.js'

const PORT = 6465
const UI_ORIGIN = 'http://127.0.0.1:5173'

async function makeApi(options: RigOptions = {}) {
  const rig = await makeRig(options)
  const app = createHttpApp({ service: rig.service, port: PORT, allowedOrigins: [UI_ORIGIN, 'http://localhost:5173'] })

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; raw?: string | Uint8Array; headers?: Record<string, string | null>; json?: boolean } = {},
  ): Promise<Response> {
    const headers = new Headers({ Host: `127.0.0.1:${PORT}` })
    if (options.json !== false && (options.body !== undefined || method === 'POST')) {
      headers.set('Content-Type', 'application/json')
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value === null) headers.delete(name)
      else headers.set(name, value)
    }
    const init: RequestInit = { method, headers }
    if (options.raw !== undefined) init.body = options.raw
    else if (options.body !== undefined) init.body = JSON.stringify(options.body)
    return app.request(path, init)
  }
  return { ...rig, app, call }
}

async function errorOf(response: Response): Promise<ApiErrorBody['error']> {
  const body = (await response.json()) as ApiErrorBody
  return body.error
}

describe('Host and Origin checks', () => {
  it('accepts 127.0.0.1:<port> and localhost:<port>', async () => {
    const { call } = await makeApi()
    expect((await call('GET', '/api/status')).status).toBe(200)
    expect((await call('GET', '/api/status', { headers: { Host: `localhost:${PORT}` } })).status).toBe(200)
    expect((await call('GET', '/api/status', { headers: { Host: `LOCALHOST:${PORT}` } })).status).toBe(200)
  })

  it('rejects any other Host on /api and /mcp (DNS rebinding)', async () => {
    const { call } = await makeApi()
    for (const host of ['evil.example', `evil.example:${PORT}`, '127.0.0.1', 'localhost', `127.0.0.1:${PORT + 1}`, `0.0.0.0:${PORT}`]) {
      for (const path of ['/api/status', '/mcp']) {
        const response = await call('GET', path, { headers: { Host: host } })
        expect(response.status, `${host} ${path}`).toBe(403)
        expect((await errorOf(response)).code).toBe('forbidden-origin')
      }
    }
    const missing = await call('GET', '/api/status', { headers: { Host: null } })
    expect(missing.status).toBe(403)
  })

  it('rejects an Origin that is not in the allowlist, including null and look-alikes', async () => {
    const { call } = await makeApi()
    for (const origin of ['http://evil.example', 'null', 'http://127.0.0.1:5174', 'https://127.0.0.1:5173', `http://127.0.0.1:${PORT}`, '*']) {
      const response = await call('GET', '/api/status', { headers: { Origin: origin } })
      expect(response.status, origin).toBe(403)
      expect((await errorOf(response)).code).toBe('forbidden-origin')
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
    const post = await call('POST', '/api/verify', { headers: { Origin: 'http://evil.example' } })
    expect(post.status).toBe(403)
  })

  it('allows the UI origin with an exact CORS header and never a wildcard', async () => {
    const { call } = await makeApi()
    const response = await call('GET', '/api/status', { headers: { Origin: UI_ORIGIN } })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(UI_ORIGIN)
    expect(response.headers.get('vary')).toBe('Origin')

    const noOrigin = await call('GET', '/api/status')
    expect(noOrigin.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers preflight only for allowed origins', async () => {
    const { call } = await makeApi()
    const ok = await call('OPTIONS', '/api/plans/keys', { headers: { Origin: UI_ORIGIN, 'Access-Control-Request-Method': 'POST' } })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe(UI_ORIGIN)
    expect(ok.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')

    const bad = await call('OPTIONS', '/api/plans/keys', { headers: { Origin: 'http://evil.example' } })
    expect(bad.status).toBe(403)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sets no-store and nosniff on responses', async () => {
    const { call } = await makeApi()
    const response = await call('GET', '/api/status')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('request body rules', () => {
  const plan = { layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } }

  it('requires Content-Type: application/json on POST', async () => {
    const { call } = await makeApi()
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'multipart/form-data']) {
      const response = await call('POST', '/api/plans/keys', { raw: JSON.stringify(plan), headers: { 'Content-Type': contentType } })
      expect(response.status, contentType).toBe(400)
      expect((await errorOf(response)).code).toBe('bad-request')
    }
    const missing = await call('POST', '/api/plans/keys', { raw: JSON.stringify(plan), json: false })
    expect(missing.status).toBe(400)
    const verify = await call('POST', '/api/verify', { json: false })
    expect(verify.status).toBe(400)
  })

  it('accepts application/json with a charset', async () => {
    const { call } = await makeApi()
    const response = await call('POST', '/api/plans/keys', {
      raw: JSON.stringify(plan),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
    expect(response.status).toBe(200)
  })

  it('rejects bodies over 256 KB by Content-Length', async () => {
    const { call } = await makeApi()
    const big = JSON.stringify({ layer: 'base', assignments: {}, pad: 'x'.repeat(MAX_BODY_BYTES) })
    const response = await call('POST', '/api/plans/keys', { raw: big })
    expect(response.status).toBe(400)
    const error = await errorOf(response)
    expect(error.code).toBe('bad-request')
    expect(error.message).toMatch(/larger than/)
  })

  it('rejects bodies over 256 KB even without a Content-Length header', async () => {
    const { app } = await makeApi()
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) controller.close()
        else {
          sent += 1
          controller.enqueue(chunk)
        }
      },
    })
    const request = new Request(`http://127.0.0.1:${PORT}/api/plans/keys`, {
      method: 'POST',
      headers: { Host: `127.0.0.1:${PORT}`, 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(request.headers.get('content-length')).toBeNull()
    const response = await app.request(request)
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toMatch(/larger than/)
  })

  it('rejects invalid JSON and invalid UTF-8', async () => {
    const { call } = await makeApi()
    const bad = await call('POST', '/api/plans/keys', { raw: '{nope' })
    expect(bad.status).toBe(400)
    expect((await errorOf(bad)).code).toBe('bad-request')
    const utf8 = await call('POST', '/api/plans/keys', { raw: new Uint8Array([0x7b, 0xff, 0x7d]) })
    expect(utf8.status).toBe(400)
  })
})

describe('error mapping', () => {
  it('maps service errors to the contract status codes', async () => {
    const rig = await makeApi()

    const validation = await rig.call('POST', '/api/plans/keys', { body: { layer: 'base', assignments: { nokey: { kind: 'none' } } } })
    expect(validation.status).toBe(API_ERROR_STATUS.validation)
    const validationError = await errorOf(validation)
    expect(validationError.code).toBe('validation')
    expect(JSON.stringify(validationError.details)).toContain('assignments')

    const extra = await rig.call('POST', '/api/plans/keys', { body: { layer: 'base', assignments: { a: { kind: 'none' } }, path: '/dev/hidraw1' } })
    expect(extra.status).toBe(400)

    const notFound = await rig.call('GET', '/api/plans/does-not-exist/preview')
    expect(notFound.status).toBe(404)
    expect((await errorOf(notFound)).code).toBe('plan-not-found')

    const created = (await (await rig.call('POST', '/api/plans/keys', { body: { layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } } })).json()) as ConfigPlan

    for (const body of [undefined, {}, { confirm: false }, { confirm: 'true' }]) {
      const response = await rig.call('POST', `/api/plans/${created.id}/apply`, body === undefined ? {} : { body })
      expect(response.status).toBe(400)
      expect((await errorOf(response)).code).toBe('confirmation-required')
    }

    const disabled = await rig.call('POST', `/api/plans/${created.id}/apply`, { body: { confirm: true } })
    expect(disabled.status).toBe(403)
    expect((await errorOf(disabled)).code).toBe('write-disabled')

    const snapshot = await rig.call('POST', '/api/snapshots/00000000-0000-4000-8000-000000000000/restore', { body: { confirm: true } })
    expect(snapshot.status).toBe(403)

    const tooLong = await rig.call('POST', '/api/snapshots', { body: { reason: 'x'.repeat(201) } })
    expect(tooLong.status).toBe(400)

    rig.backend.connected = false
    const disconnected = await rig.call('GET', '/api/config')
    expect(disconnected.status).toBe(409)
    expect((await errorOf(disconnected)).code).toBe('not-connected')
  })

  it('maps stale plans, missing snapshots and device errors', async () => {
    const rig = await makeApi({ allowWrites: true })
    const make = async (key: string): Promise<ConfigPlan> =>
      (await (await rig.call('POST', '/api/plans/keys', { body: { layer: 'base', assignments: { [key]: { kind: 'none' } } } })).json()) as ConfigPlan
    const first = await make('a')
    const second = await make('b')
    expect((await rig.call('POST', `/api/plans/${second.id}/apply`, { body: { confirm: true } })).status).toBe(200)

    const stale = await rig.call('POST', `/api/plans/${first.id}/apply`, { body: { confirm: true } })
    expect(stale.status).toBe(409)
    expect((await errorOf(stale)).code).toBe('plan-stale')

    const missing = await rig.call('POST', '/api/snapshots/nope/restore', { body: { confirm: true } })
    expect(missing.status).toBe(404)
    expect((await errorOf(missing)).code).toBe('snapshot-not-found')

    rig.backend.failReads = new Error('read failed')
    const device = await rig.call('GET', '/api/config')
    expect(device.status).toBe(502)
    expect((await errorOf(device)).code).toBe('device-error')
  })

  it('hides internal errors: no message, no stack', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const service = {
      status: () => Promise.reject(new TypeError('secret detail at /home/user/file.ts')),
    } as unknown as KeyboardService
    const app = createHttpApp({ service, port: PORT, allowedOrigins: [] })
    const response = await app.request('/api/status', { headers: { Host: `127.0.0.1:${PORT}` } })
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: 'Internal error' } })
    expect(text).not.toContain('secret')
    expect(text).not.toContain('.ts')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('answers unknown routes with 404 and wrong methods on /mcp with 405', async () => {
    const { call } = await makeApi()
    const unknown = await call('GET', '/api/raw-hid')
    expect(unknown.status).toBe(404)
    expect((await errorOf(unknown)).code).toBe('bad-request')
    const mcp = await call('GET', '/mcp')
    expect(mcp.status).toBe(405)
    expect(mcp.headers.get('allow')).toBe('POST')
    expect((await call('POST', '/api/plans/keys/extra', { body: {} })).status).toBe(404)
  })
})

describe('plan -> preview -> apply -> verify -> restore over HTTP', () => {
  it('runs the whole flow on the mock backend', async () => {
    const { call, backend } = await makeApi({ allowWrites: true })

    const status = (await (await call('GET', '/api/status')).json()) as { writeEnabled: boolean; configRevision: string }
    expect(status.writeEnabled).toBe(true)
    const layout = (await (await call('GET', '/api/layout')).json()) as { keyCount: number }
    expect(layout.keyCount).toBe(64)

    const planResponse = await call('POST', '/api/plans/keys', { body: { layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } } })
    expect(planResponse.status).toBe(200)
    const plan = (await planResponse.json()) as ConfigPlan
    expect(plan.baseRevision).toBe(status.configRevision)

    const plans = (await (await call('GET', '/api/plans')).json()) as ConfigPlan[]
    expect(plans.map((item) => item.id)).toEqual([plan.id])

    const preview = (await (await call('GET', `/api/plans/${plan.id}/preview`)).json()) as { affectedKeys: string[]; diff: unknown[] }
    expect(preview.affectedKeys).toEqual(['capslock'])
    expect(preview.diff).toHaveLength(1)
    expect(backend.writes).toHaveLength(0)

    const apply = await call('POST', `/api/plans/${plan.id}/apply`, { body: { confirm: true } })
    expect(apply.status).toBe(200)
    const applied = (await apply.json()) as { applied: boolean; verified: boolean; snapshotId: string }
    expect(applied).toMatchObject({ applied: true, verified: true })

    expect(((await (await call('POST', '/api/verify')).json()) as { ok: boolean }).ok).toBe(true)
    const config = (await (await call('GET', '/api/config')).json()) as { layers: { base: Record<string, unknown> } }
    expect(config.layers.base.capslock).toEqual({ kind: 'key', code: 'escape' })

    const manual = await call('POST', '/api/snapshots', { body: { reason: 'manual check' } })
    expect(manual.status).toBe(200)
    const empty = await call('POST', '/api/snapshots')
    expect(empty.status).toBe(200)
    const snapshots = (await (await call('GET', '/api/snapshots')).json()) as Array<{ id: string }>
    expect(snapshots).toHaveLength(3)

    const restore = await call('POST', `/api/snapshots/${applied.snapshotId}/restore`, { body: { confirm: true } })
    expect(restore.status).toBe(200)
    expect(await restore.json()).toMatchObject({ snapshotId: applied.snapshotId, applied: true, verified: true })
    const after = (await (await call('GET', '/api/layout')).json()) as unknown
    expect(after).toBeTruthy()
    const lighting = await call('POST', '/api/plans/lighting', { body: { zones: { wasd: '#ff0000' }, brightness: 70 } })
    expect(lighting.status).toBe(200)
    const macro = await call('POST', '/api/plans/macro', { body: { macro: { id: 'm1', name: 'Hi', steps: [{ type: 'key', code: 'h' }] } } })
    expect(macro.status).toBe(200)
    expect(((await (await call('GET', '/api/macros')).json()) as unknown[]).length).toBe(0)
    expect(((await (await call('GET', '/api/lighting')).json()) as { effect: string }).effect).toBe('off')
  })
})
