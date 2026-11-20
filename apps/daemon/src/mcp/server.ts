import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { KeyboardService, ToolName } from '@perifmcp/core'
import { mapError } from '../http/errors.js'
import { TOOLS, TOOL_NAMES, isReadOnlyTool, type ToolDefinition } from './tools.js'

function structured(output: unknown): Record<string, unknown> {
  // structuredContent must be an object, so list outputs are wrapped.
  return Array.isArray(output) ? { items: output } : (output as Record<string, unknown>)
}

function errorResult(error: unknown): CallToolResult {
  const { body } = mapError(error)
  return {
    isError: true,
    content: [{ type: 'text', text: `${body.error.code}: ${body.error.message}` }],
    structuredContent: { ...body },
  }
}

async function callTool<K extends ToolName>(
  service: KeyboardService,
  definition: ToolDefinition<K>,
  raw: unknown,
): Promise<CallToolResult> {
  try {
    const input = definition.parse(raw)
    const output = await definition.run(service, input)
    return {
      content: [{ type: 'text', text: definition.summarize(output, input) }],
      structuredContent: structured(output),
    }
  } catch (error) {
    return errorResult(error)
  }
}

function register<K extends ToolName>(server: McpServer, service: KeyboardService, name: K): void {
  const definition = TOOLS[name] as ToolDefinition<K>
  const readOnly = isReadOnlyTool(name)
  server.registerTool(
    name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: {
        title: definition.title,
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint: false,
      },
    },
    (args: unknown) => callTool(service, definition, args),
  )
}

/** An MCP server with exactly the tools in `ToolContract`. */
export function createMcpServer(service: KeyboardService): McpServer {
  const server = new McpServer({ name: 'perifmcp', version: '0.1.0' })
  for (const name of TOOL_NAMES) register(server, service, name)
  return server
}

/**
 * Stateless Streamable HTTP: a fresh server and transport per request, JSON responses.
 * Host, Origin, content type and body size were already checked by the security middleware.
 */
export async function handleMcpRequest(service: KeyboardService, request: Request, parsedBody: unknown): Promise<Response> {
  const server = createMcpServer(service)
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request, { parsedBody })
  } finally {
    await transport.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}
