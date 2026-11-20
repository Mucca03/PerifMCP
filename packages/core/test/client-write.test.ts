import { describe, expect, it } from 'vitest'
import {
  CommandNotAllowedError,
  DATA_TYPE,
  DEVICE_LAYER,
  Gk6xClient,
  buildKeySetWrite,
  buildPacket,
  buildResetPacket,
  guardConnection,
  type DeviceSummary,
  type HidConnection,
} from '../src/index.js'

const info: DeviceSummary = { id: 'test', vendorId: 0x1ea7, productId: 0x0907 }

function echoConnection(respond: (packet: Uint8Array) => Uint8Array = (packet) => packet): HidConnection & { sent: Uint8Array[] } {
  const sent: Uint8Array[] = []
  return {
    info,
    sent,
    async send(packet) {
      sent.push(packet)
      return respond(packet)
    },
    async close() {},
  }
}

const packets = buildKeySetWrite(DEVICE_LAYER.base, [0x02000400, 0xffffffff], false)

describe('Gk6xClient.writePackets', () => {
  it('sends the packets in order and accepts matching responses', async () => {
    const connection = echoConnection()
    await new Gk6xClient(guardConnection(connection, { mode: 'read-write' })).writePackets(packets)
    expect(connection.sent).toEqual(packets)
  })

  it('is stopped by the guard in read-only mode before anything reaches the device', async () => {
    const connection = echoConnection()
    const client = new Gk6xClient(guardConnection(connection))
    await expect(client.writePackets(packets)).rejects.toBeInstanceOf(CommandNotAllowedError)
    expect(connection.sent).toEqual([])
  })

  it('checks every packet before sending the first one', async () => {
    const connection = echoConnection()
    const client = new Gk6xClient(connection)
    const restart = buildPacket({ command: 0x03 })
    const usbId = buildPacket({ command: 0x41, subCommand: 0x01 })
    await expect(client.writePackets([buildResetPacket(DEVICE_LAYER.base, DATA_TYPE.keySet), restart])).rejects.toThrow(/not a known write command/)
    await expect(client.writePackets([packets[0] as Uint8Array, usbId])).rejects.toThrow(/not a known write command/)
    await expect(client.writePackets([new Uint8Array(10)])).rejects.toThrow(/expected 64/)
    const corrupt = (packets[0] as Uint8Array).slice()
    corrupt[30] = (corrupt[30] ?? 0) ^ 1
    await expect(client.writePackets([corrupt])).rejects.toThrow(/CRC/)
    expect(connection.sent).toEqual([])
  })

  it('fails on a response with another command or a bad CRC', async () => {
    const wrongCommand = new Gk6xClient(echoConnection(() => buildPacket({ command: 0x0c })))
    await expect(wrongCommand.writePackets(packets)).rejects.toThrow(/Unexpected response command/)

    const badCrc = new Gk6xClient(
      echoConnection((packet) => {
        const copy = packet.slice()
        copy[40] = (copy[40] ?? 0) ^ 0xff
        return copy
      }),
    )
    await expect(badCrc.writePackets(packets)).rejects.toThrow(/CRC mismatch/)
  })
})
