import { Hono } from 'hono'
import type { Context } from 'hono'
import { API_PREFIX } from '@perifmcp/core'
import type { ApiRoute, ApiRoutes, KeyboardService } from '@perifmcp/core'
import { handleMcpRequest } from '../mcp/server.js'
import {
  confirmBodySchema,
  idSchema,
  keysPlanInputSchema,
  lightingPlanInputSchema,
  macroPlanInputSchema,
  parseConfirmed,
  parseInput,
  snapshotInputSchema,
} from '../schemas.js'
import { HttpError, errorResponse } from './errors.js'
import { readJsonBody, securityMiddleware, type SecurityOptions } from './security.js'

export interface HttpAppOptions extends SecurityOptions {
  service: KeyboardService
}

/** Typed JSON reply: the data must match the contract for the route. */
function reply<R extends ApiRoute>(c: Context, _route: R, data: ApiRoutes[R]['response']): Response {
  return c.json(data as never)
}

function paramId(c: Context): string {
  return parseInput(idSchema, c.req.param('id'))
}

export function createHttpApp(options: HttpAppOptions): Hono {
  const { service } = options
  const app = new Hono()

  app.use('*', securityMiddleware(options))
  app.onError((error, c) => errorResponse(c, error))
  app.notFound((c) => errorResponse(c, new HttpError('bad-request', 'Not found', 404)))

  // --- Reads ---------------------------------------------------------------
  app.get(`${API_PREFIX}/status`, async (c) => reply(c, 'GET /api/status', await service.status()))
  app.get(`${API_PREFIX}/layout`, async (c) => reply(c, 'GET /api/layout', await service.getLayout()))
  app.get(`${API_PREFIX}/config`, async (c) => reply(c, 'GET /api/config', await service.getConfig()))
  app.get(`${API_PREFIX}/macros`, async (c) => reply(c, 'GET /api/macros', await service.getMacros()))
  app.get(`${API_PREFIX}/lighting`, async (c) => reply(c, 'GET /api/lighting', await service.getLighting()))

  // --- Plans ---------------------------------------------------------------
  app.post(`${API_PREFIX}/plans/keys`, async (c) => {
    const input = parseInput(keysPlanInputSchema, await readJsonBody(c))
    return reply(c, 'POST /api/plans/keys', await service.planKeys(input))
  })
  app.post(`${API_PREFIX}/plans/macro`, async (c) => {
    const input = parseInput(macroPlanInputSchema, await readJsonBody(c))
    return reply(c, 'POST /api/plans/macro', await service.planMacro(input))
  })
  app.post(`${API_PREFIX}/plans/lighting`, async (c) => {
    const input = parseInput(lightingPlanInputSchema, await readJsonBody(c))
    return reply(c, 'POST /api/plans/lighting', await service.planLighting(input))
  })
  app.get(`${API_PREFIX}/plans`, async (c) => reply(c, 'GET /api/plans', await service.listPlans()))
  app.get(`${API_PREFIX}/plans/:id/preview`, async (c) =>
    reply(c, 'GET /api/plans/:id/preview', await service.previewPlan(paramId(c))),
  )
  app.post(`${API_PREFIX}/plans/:id/apply`, async (c) => {
    parseConfirmed(confirmBodySchema, await readJsonBody(c))
    return reply(c, 'POST /api/plans/:id/apply', await service.applyPlan(paramId(c), true))
  })

  // --- Verify and snapshots --------------------------------------------------
  app.post(`${API_PREFIX}/verify`, async (c) => reply(c, 'POST /api/verify', await service.verify()))

  app.get(`${API_PREFIX}/snapshots`, async (c) => reply(c, 'GET /api/snapshots', await service.listSnapshots()))
  app.post(`${API_PREFIX}/snapshots`, async (c) => {
    const body = parseInput(snapshotInputSchema, (await readJsonBody(c)) ?? {})
    return reply(c, 'POST /api/snapshots', await service.snapshot(body.reason))
  })
  app.post(`${API_PREFIX}/snapshots/:id/restore`, async (c) => {
    parseConfirmed(confirmBodySchema, await readJsonBody(c))
    return reply(c, 'POST /api/snapshots/:id/restore', await service.restore(paramId(c), true))
  })

  // --- MCP (Streamable HTTP, stateless, JSON responses) ----------------------
  app.post('/mcp', async (c) => {
    const body = await readJsonBody(c)
    if (body === undefined) throw new HttpError('bad-request', 'Request body is required')
    return handleMcpRequest(service, c.req.raw, body)
  })
  app.all('/mcp', (c) => {
    const response = errorResponse(c, new HttpError('bad-request', 'Use POST for MCP requests', 405))
    response.headers.set('Allow', 'POST')
    return response
  })

  return app
}
