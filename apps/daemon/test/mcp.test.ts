import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PLANNING_TOOLS, READ_ONLY_TOOLS, WRITE_TOOLS } from '@perifmcp/core'
import type { ConfigPlan, ToolContract, ToolName } from '@perifmcp/core'
import { createHttpApp } from '../src/http/app.js'
import { createMcpServer } from '../src/mcp/server.js'
import { TOOLS, TOOL_NAMES } from '../src/mcp/tools.js'
import { makeRig, type RigOptions, type TestRig } from './helpers.js'

const CONTRACT_TOOLS: string[] = [...READ_ONLY_TOOLS, ...PLANNING_TOOLS, ...WRITE_TOOLS].sort()

interface ToolOutcome {
  isError: boolean
  text: string
  data: Record<string, unknown>
}

async function connect(options: RigOptions = {}): Promise<{
  rig: TestRig
  client: Client
  call(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>
}> {
  const rig = await makeRig(options)
  const server = createMcpServer(rig.service)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
    try {
      const result = await client.callTool({ name, arguments: args })
      const content = result.content as Array<{ type: string; text?: string }>
      return {
        isError: result.isError === true,
        text: content.map((item) => item.text ?? '').join('\n'),
        data: (result.structuredContent ?? {}) as Record<string, unknown>,
      }
    } catch (error) {
      // The SDK may reject invalid arguments at the protocol level instead of in the result.
      return { isError: true, text: error instanceof Error ? error.message : String(error), data: {} }
    }
  }
  return { rig, client, call }
}

describe('tool list', () => {
  it('registers exactly the tools in ToolContract, nothing more', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(CONTRACT_TOOLS)
    expect(tools).toHaveLength(14)
    expect(Object.keys(TOOLS).sort()).toEqual(CONTRACT_TOOLS)
    expect([...TOOL_NAMES].sort()).toEqual(CONTRACT_TOOLS)
  })

  it('has no raw HID, command, path or firmware tool', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.name).toMatch(/^keyboard_[a-z_]+$/)
      expect(tool.name).not.toMatch(/raw|hid|packet|command|firmware|flash|send/)
      const properties = JSON.stringify(tool.inputSchema)
      expect(properties).not.toMatch(/"(bytes|packet|command|path|firmware|data)"/)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('marks read-only and planning tools as read-only and write tools as destructive', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    for (const tool of tools) {
      const readOnly = ([...READ_ONLY_TOOLS, ...PLANNING_TOOLS] as string[]).includes(tool.name)
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(readOnly)
      expect(tool.annotations?.destructiveHint, tool.name).toBe(!readOnly)
    }
  })

  it('advertises strict inputs', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    for (const tool of tools) expect(tool.inputSchema.additionalProperties, tool.name).toBe(false)
  })
})

describe('read-only mode', () => {
  it('runs every read-only tool and returns structured output plus a text summary', async () => {
    const { call } = await connect()
    const calls: Array<[ToolName, Record<string, unknown>]> = [
      ['keyboard_status', {}],
      ['keyboard_get_layout', {}],
      ['keyboard_get_config', {}],
      ['keyboard_get_config', { layer: 'base' }],
      ['keyboard_get_macros', {}],
      ['keyboard_get_lighting', {}],
      ['keyboard_verify', {}],
      ['keyboard_list_snapshots', {}],
    ]
    for (const [name, args] of calls) {
      const outcome = await call(name, args)
      expect(outcome.isError, `${name}: ${outcome.text}`).toBe(false)
      expect(outcome.text.length).toBeGreaterThan(0)
      expect(Object.keys(outcome.data).length).toBeGreaterThan(0)
    }

    const status = (await call('keyboard_status')).data as unknown as ToolContract['keyboard_status']['output']
    expect(status.writeEnabled).toBe(false)
    const layer = (await call('keyboard_get_config', { layer: 'base' })).data
    expect(layer.layer).toBe('base')
    expect(Object.keys(layer.assignments as object)).toHaveLength(64)
    expect((await call('keyboard_get_macros')).data).toEqual({ items: [] })
  })

  it('runs planning tools and preview, but write tools report write-disabled', async () => {
    const { call, rig } = await connect()
    const plan = await call('keyboard_plan_keys', { layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } })
    expect(plan.isError, plan.text).toBe(false)
    const planId = (plan.data as unknown as ConfigPlan).id

    const macro = await call('keyboard_plan_macro', { macro: { id: 'm', name: 'M', steps: [{ type: 'key', code: 'a' }] } })
    expect(macro.isError).toBe(false)
    const lighting = await call('keyboard_plan_lighting', { zones: { wasd: '#00ff00' }, brightness: 60 })
    expect(lighting.isError).toBe(false)

    const preview = await call('keyboard_preview_plan', { planId })
    expect(preview.isError).toBe(false)
    expect(preview.data.affectedKeys).toEqual(['capslock'])

    const apply = await call('keyboard_apply_plan', { planId, confirm: true })
    expect(apply.isError).toBe(true)
    expect(apply.text).toMatch(/^write-disabled/)
    expect((apply.data.error as { code: string }).code).toBe('write-disabled')

    const restore = await call('keyboard_restore', { snapshotId: 'x', confirm: true })
    expect(restore.isError).toBe(true)
    expect(restore.text).toMatch(/^write-disabled/)
    expect(rig.backend.writes).toHaveLength(0)
  })

  it('takes a snapshot in read-only mode', async () => {
    const { call } = await connect()
    const snapshot = await call('keyboard_snapshot', { reason: 'before experiments' })
    expect(snapshot.isError).toBe(false)
    expect(snapshot.data.reason).toBe('before experiments')
    const list = await call('keyboard_list_snapshots')
    expect((list.data.items as unknown[]).length).toBe(1)
  })
})

describe('input validation', () => {
  it('rejects inputs that violate the schemas', async () => {
    const { call, rig } = await connect({ allowWrites: true })
    const cases: Array<[string, Record<string, unknown>]> = [
      ['keyboard_plan_keys', { layer: 'fn9', assignments: { a: { kind: 'none' } } }],
      ['keyboard_plan_keys', { layer: 'base', assignments: { nokey: { kind: 'none' } } }],
      ['keyboard_plan_keys', { layer: 'base', assignments: { a: { kind: 'key', code: 'nope' } } }],
      ['keyboard_plan_keys', { layer: 'base' }],
      ['keyboard_plan_lighting', { base: 'red' }],
      ['keyboard_plan_lighting', { speed: 101 }],
      ['keyboard_plan_lighting', { brightness: -5 }],
      ['keyboard_plan_lighting', { effect: 'disco' }],
      ['keyboard_plan_macro', { macro: { id: 'm', name: 'M', steps: [{ type: 'delay', ms: 60001 }] } }],
      ['keyboard_plan_macro', { macro: { id: 'm', name: 'M', steps: [{ type: 'delay', ms: 1 }], repeat: 1001 } }],
      ['keyboard_get_config', { layer: 'nope' }],
      ['keyboard_status', { raw: 'ff' }],
      ['keyboard_snapshot', { reason: 'x'.repeat(201) }],
      ['keyboard_preview_plan', {}],
      ['keyboard_apply_plan', { confirm: true }],
    ]
    for (const [name, args] of cases) {
      const outcome = await call(name, args)
      expect(outcome.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    expect(rig.backend.writes).toHaveLength(0)
  })

  it('rejects an unknown tool', async () => {
    const { call } = await connect()
    for (const name of ['keyboard_raw_write', 'keyboard_send_packet', 'keyboard_flash_firmware']) {
      expect((await call(name, { bytes: [1] })).isError).toBe(true)
    }
  })

  it('reports a missing or non-true confirm as confirmation-required', async () => {
    const { call, rig } = await connect({ allowWrites: true })
    const plan = (await call('keyboard_plan_keys', { layer: 'base', assignments: { capslock: { kind: 'none' } } })).data as unknown as ConfigPlan
    for (const confirm of [undefined, false, 'true', 1, null]) {
      const args: Record<string, unknown> = { planId: plan.id }
      if (confirm !== undefined) args.confirm = confirm
      const outcome = await call('keyboard_apply_plan', args)
      expect(outcome.isError).toBe(true)
      expect(outcome.text).toMatch(/^confirmation-required/)
      const restore = await call('keyboard_restore', { snapshotId: 'x', ...(confirm === undefined ? {} : { confirm }) })
      expect(restore.text).toMatch(/^confirmation-required/)
    }
    expect(rig.backend.writes).toHaveLength(0)
  })

  it('maps service errors to isError results with the code', async () => {
    const { call } = await connect({ allowWrites: true })
    const notFound = await call('keyboard_apply_plan', { planId: 'missing', confirm: true })
    expect(notFound.isError).toBe(true)
    expect(notFound.text).toMatch(/^plan-not-found/)
    const preview = await call('keyboard_preview_plan', { planId: 'missing' })
    expect(preview.text).toMatch(/^plan-not-found/)
    const snapshot = await call('keyboard_restore', { snapshotId: '../../etc/passwd', confirm: true })
    expect(snapshot.text).toMatch(/^snapshot-not-found/)
  })
})

describe('full flow through MCP tools', () => {
  it('plans, previews, applies, verifies and restores', async () => {
    const { call, rig } = await connect({ allowWrites: true })

    const plan = await call('keyboard_plan_keys', { layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } })
    const planId = (plan.data as unknown as ConfigPlan).id
    expect(plan.text).toContain(planId)

    const preview = await call('keyboard_preview_plan', { planId })
    expect((preview.data.diff as unknown[]).length).toBe(1)

    const applied = await call('keyboard_apply_plan', { planId, confirm: true })
    expect(applied.isError, applied.text).toBe(false)
    expect(applied.data).toMatchObject({ planId, applied: true, verified: true })
    const snapshotId = applied.data.snapshotId as string
    expect(rig.backend.writes).toHaveLength(1)

    expect((await call('keyboard_verify')).data).toEqual({ ok: true, mismatches: [] })
    const layer = (await call('keyboard_get_config', { layer: 'base' })).data.assignments as Record<string, unknown>
    expect(layer.capslock).toEqual({ kind: 'key', code: 'escape' })

    const restored = await call('keyboard_restore', { snapshotId, confirm: true })
    expect(restored.isError, restored.text).toBe(false)
    expect(restored.data).toMatchObject({ snapshotId, applied: true, verified: true })
    const back = (await call('keyboard_get_config', { layer: 'base' })).data.assignments as Record<string, unknown>
    expect(back.capslock).toEqual({ kind: 'key', code: 'capslock' })
  })
})

describe('/mcp over HTTP', () => {
  async function makeHttp(): Promise<{ post(body: unknown, headers?: Record<string, string | null>): Promise<Response> }> {
    const rig = await makeRig()
    const app = createHttpApp({ service: rig.service, port: 6465, allowedOrigins: ['http://127.0.0.1:5173'] })
    return {
      async post(body, headers = {}) {
        const merged = new Headers({
          Host: '127.0.0.1:6465',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        })
        for (const [name, value] of Object.entries(headers)) {
          if (value === null) merged.delete(name)
          else merged.set(name, value)
        }
        return app.request('/mcp', { method: 'POST', headers: merged, body: JSON.stringify(body) })
      },
    }
  }

  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'curl', version: '0' } },
  }

  it('initializes and lists the contract tools', async () => {
    const { post } = await makeHttp()
    const init = await post(initialize)
    expect(init.status).toBe(200)
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } }
    expect(initBody.result.serverInfo.name).toBe('perifmcp')

    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual(CONTRACT_TOOLS)
  })

  it('calls a tool', async () => {
    const { post } = await makeHttp()
    const response = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'keyboard_status', arguments: {} } })
    const body = (await response.json()) as { result: { structuredContent: { connection: string }; isError?: boolean } }
    expect(body.result.structuredContent.connection).toBe('connected')
    expect(body.result.isError).not.toBe(true)
  })

  it('applies the same Host, Origin, content-type and size checks as /api', async () => {
    const { post } = await makeHttp()
    expect((await post(initialize, { Host: 'evil.example' })).status).toBe(403)
    expect((await post(initialize, { Origin: 'http://evil.example' })).status).toBe(403)
    expect((await post(initialize, { 'Content-Type': 'text/plain' })).status).toBe(400)
    expect((await post({ ...initialize, pad: 'x'.repeat(300_000) })).status).toBe(400)
  })

  it('rejects clients that do not accept JSON and event streams', async () => {
    const { post } = await makeHttp()
    expect((await post(initialize, { Accept: 'application/json' })).status).toBe(406)
  })
})
