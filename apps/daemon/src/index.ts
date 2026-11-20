import { serve } from '@hono/node-server'
import { createDaemon } from './app.js'
import { ConfigError, loadConfig } from './config.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const daemon = await createDaemon(config)

  const server = serve({ fetch: daemon.app.fetch, port: config.port, hostname: config.host }, (address) => {
    console.log(`PerifMCP daemon listening on http://${config.host}:${address.port}`)
    console.log(`  backend: ${config.backend}`)
    console.log(`  writes: ${config.allowWrites ? 'allowed by environment (model and backend must also allow)' : 'disabled'}`)
    console.log('  API: /api/*   MCP: /mcp')
  })

  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    server.close(() => {
      void daemon.close().finally(() => process.exit(0))
    })
    // Do not wait forever for idle keep-alive connections.
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`configuration error: ${error.message}`)
  } else {
    console.error('daemon failed to start:', error instanceof Error ? error.message : error)
  }
  process.exitCode = 1
})
