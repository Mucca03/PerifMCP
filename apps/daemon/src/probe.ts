import { Gk6xClient, guardConnection } from '@perifmcp/core'
import { HidrawTransport } from './transport/hidraw.js'

async function main(): Promise<void> {
  const transport = new HidrawTransport()
  const devices = await transport.list()

  console.log('devices:', JSON.stringify(devices, null, 2))
  if (devices.length === 0) {
    throw new Error('No 1ea7:0907 device found')
  }

  // Read-only guard: only identification commands (0x01 info, 0x0c ping) can leave this process.
  const connection = guardConnection(await transport.openVendorInterface(), { mode: 'read-only' })
  const client = new Gk6xClient(connection)

  try {
    // The GK6X reference tool sends ping without waiting for a reply, so a missing reply is not fatal.
    try {
      await client.ping(1500)
      console.log('ping: reply received')
    } catch (error) {
      console.log('ping: no reply (continuing):', error instanceof Error ? error.message : error)
    }

    const version = await client.version()
    console.log('version:', version)

    const deviceId = await client.deviceId()
    console.log('deviceId:', deviceId)

    const modelId = await client.modelId()
    console.log('modelId:', modelId)

    const matrix = await client.matrix()
    console.log('matrix:', matrix)
  } finally {
    await client.close()
  }
}

main().catch((error: unknown) => {
  console.error('probe failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
