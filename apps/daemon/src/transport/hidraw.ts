import { HID, devices, type Device } from 'node-hid'
import type { DeviceSummary, HidConnection, HidTransport } from '@perifmcp/core'

const VENDOR_ID = 0x1ea7
const PRODUCT_ID = 0x0907
const VENDOR_USAGE_PAGE = 0xff00

function normalizeReport(data: Buffer): Uint8Array {
  // Some platforms prefix reports with a report ID. This device uses raw 64-byte
  // reports on the vendor interface, but tolerate the extra byte.
  const bytes = data.length === 65 && data[0] === 0 ? data.subarray(1) : data
  const report = new Uint8Array(64)
  report.set(bytes.subarray(0, 64))
  return report
}

function toSummary(device: Device): DeviceSummary {
  const path = device.path ?? `hidraw:${device.vendorId}:${device.productId}:${device.interface}`
  return {
    id: path,
    vendorId: device.vendorId,
    productId: device.productId,
    ...(device.manufacturer === undefined ? {} : { manufacturer: device.manufacturer }),
    ...(device.product === undefined ? {} : { product: device.product }),
    ...(device.serialNumber === undefined ? {} : { serialNumber: device.serialNumber }),
    ...(device.usagePage === undefined ? {} : { usagePage: device.usagePage }),
    path,
  }
}

class NodeHidConnection implements HidConnection {
  constructor(
    private readonly hid: HID,
    readonly info: DeviceSummary,
  ) {}

  send(packet: Uint8Array, timeoutMs = 1500): Promise<Uint8Array> {
    if (packet.length !== 64) {
      return Promise.reject(new RangeError(`expected 64 bytes, got ${packet.length}`))
    }

    const expectedCommand = packet[0]
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        finish(new Error(`HID response timeout after ${timeoutMs} ms`))
      }, timeoutMs)

      const finish = (error?: Error, value?: Uint8Array): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.hid.removeListener('data', onData)
        this.hid.removeListener('error', onError)
        if (error) reject(error)
        else resolve(value ?? new Uint8Array(64))
      }

      const onData = (data: Buffer): void => {
        const report = normalizeReport(data)
        if (report[0] !== expectedCommand) return
        finish(undefined, report)
      }

      const onError = (error: Error): void => {
        finish(error)
      }

      this.hid.on('data', onData)
      this.hid.on('error', onError)

      try {
        this.hid.write(Buffer.from(packet))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async close(): Promise<void> {
    this.hid.close()
  }
}

export class HidrawTransport implements HidTransport {
  readonly kind = 'hidraw' as const

  async list(): Promise<DeviceSummary[]> {
    return devices()
      .filter((device) => device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID)
      .map((device) => toSummary(device))
  }

  async open(deviceId: string): Promise<HidConnection> {
    const candidates = await this.list()
    const info = candidates.find((device) => device.id === deviceId)
    if (!info) {
      throw new Error(`Keyboard ${deviceId} is not connected`)
    }

    const hid = new HID(deviceId)
    return new NodeHidConnection(hid, info)
  }

  async openVendorInterface(): Promise<HidConnection> {
    const candidates = await this.list()
    const info =
      candidates.find((device) => device.usagePage === VENDOR_USAGE_PAGE) ??
      candidates.find((device) => device.path !== undefined)

    if (!info?.path) {
      throw new Error('No GK6X/Semitek vendor HID interface found')
    }

    const hid = new HID(info.path)
    return new NodeHidConnection(hid, info)
  }
}
