import type { Context, MiddlewareHandler } from 'hono'
import { MAX_BODY_BYTES } from '../limits.js'
import { HttpError, errorResponse } from './errors.js'

export interface SecurityOptions {
  port: number
  allowedOrigins: readonly string[]
}

const JSON_CONTENT_TYPE_RE = /^application\/json\s*(;.*)?$/i

/**
 * Applies to every route (`/api/*`, `/mcp`):
 * - `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding).
 * - `Origin`, when present, must be in the allowlist. CORS headers are only sent for those
 *   origins, never `*`.
 * - `POST` needs `Content-Type: application/json` (so a cross-site HTML form cannot reach it
 *   without a preflight) and a body of at most `MAX_BODY_BYTES`.
 */
export function securityMiddleware(options: SecurityOptions): MiddlewareHandler {
  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const allowedOrigins = new Set(options.allowedOrigins)

  return async (c, next) => {
    const host = c.req.header('host')?.toLowerCase()
    if (host === undefined || !allowedHosts.has(host)) {
      return errorResponse(c, new HttpError('forbidden-origin', 'Host not allowed'))
    }

    const origin = c.req.header('origin')
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return errorResponse(c, new HttpError('forbidden-origin', 'Origin not allowed'))
    }

    if (c.req.method === 'OPTIONS') {
      // Preflight. Only meaningful (and only answered) for an allowed origin.
      if (origin === undefined) return errorResponse(c, new HttpError('bad-request', 'Not a preflight request', 400))
      return new Response(null, { status: 204, headers: corsHeaders(origin, true) })
    }

    if (c.req.method === 'POST') {
      const contentType = c.req.header('content-type')
      if (contentType === undefined || !JSON_CONTENT_TYPE_RE.test(contentType.trim())) {
        return errorResponse(c, new HttpError('bad-request', 'Content-Type must be application/json'))
      }
      const length = c.req.header('content-length')
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
        return errorResponse(c, new HttpError('bad-request', `Request body is larger than ${MAX_BODY_BYTES} bytes`))
      }
    }

    await next()

    const headers = new Headers(c.res.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('X-Content-Type-Options', 'nosniff')
    if (origin !== undefined) {
      for (const [name, value] of corsHeaders(origin, false)) headers.set(name, value)
    }
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers })
    return undefined
  }
}

function corsHeaders(origin: string, preflight: boolean): Headers {
  const headers = new Headers({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' })
  if (preflight) {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id')
    headers.set('Access-Control-Max-Age', '600')
  }
  return headers
}

/**
 * Reads a JSON request body with a hard size cap, even when `Content-Length` is missing or wrong.
 * An empty body gives `undefined`.
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  const stream = c.req.raw.body
  if (stream === null) return undefined

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new HttpError('bad-request', `Request body is larger than ${MAX_BODY_BYTES} bytes`)
    }
    chunks.push(value)
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    if (text.trim() === '') return undefined
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpError('bad-request', 'Request body is not valid JSON')
  }
}
