import type { EventEmitter } from 'node:events'
import type { Device } from 'node-hid'
import type { DeviceSummary, HidConnection, HidTransport } from '@perifmcp/core'

const VENDOR_ID = 0x1ea7
const PRODUCT_ID = 0x0907
const VENDOR_USAGE_PAGE = 0xff00
const REPORT_SIZE = 64

/**
 * The part of `node-hid`'s `HID` class this transport uses. Tests pass a fake that
 * implements it, so no test ever opens a real device.
 */
export interface HidLike extends Pick<EventEmitter, 'on' | 'removeListener'> {
  write(data: Buffer): number
  close(): void
}

/** `node-hid` is loaded lazily so that importing this module never touches the native addon. */
async function loadNodeHid(): Promise<typeof import('node-hid')> {
  return import('node-hid')
}

function normalizeReport(data: Buffer): Uint8Array {
  // Some platforms prefix reports with a report ID. This device uses raw 64-byte
  // reports on the vendor interface, but tolerate the extra byte.
  const bytes = data.length === REPORT_SIZE + 1 && data[0] === 0 ? data.subarray(1) : data
  const report = new Uint8Array(REPORT_SIZE)
  report.set(bytes.subarray(0, REPORT_SIZE))
  return report
}

/**
 * `hidapi` (and so `node-hid`) treats the first byte passed to `write` as the report ID.
 * The vendor interface has no numbered reports (checked read-only on /dev/hidraw1), so the
 * first byte must be 0x00 and is not sent on the wire. Without it the first byte of the
 * packet (the command) would be taken as a report ID and the last byte dropped.
 */
export function toOutputReport(packet: Uint8Array): Buffer {
  const report = Buffer.alloc(REPORT_SIZE + 1)
  report[0] = 0x00
  report.set(packet, 1)
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

export class NodeHidConnection implements HidConnection {
  constructor(
    private readonly hid: HidLike,
    readonly info: DeviceSummary,
  ) {}

  send(packet: Uint8Array, timeoutMs = 1500): Promise<Uint8Array> {
    if (packet.length !== REPORT_SIZE) {
      return Promise.reject(new RangeError(`expected ${REPORT_SIZE} bytes, got ${packet.length}`))
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
        else resolve(value ?? new Uint8Array(REPORT_SIZE))
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
        this.hid.write(toOutputReport(packet))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async close(): Promise<void> {
    this.hid.close()
  }
}

export type HidFactory = (path: string) => Promise<HidLike>

const openNodeHid: HidFactory = async (path) => {
  const { HID } = await loadNodeHid()
  return new HID(path)
}

export class HidrawTransport implements HidTransport {
  readonly kind = 'hidraw' as const

  constructor(private readonly openHid: HidFactory = openNodeHid) {}

  async list(): Promise<DeviceSummary[]> {
    const { devices } = await loadNodeHid()
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

    return new NodeHidConnection(await this.openHid(deviceId), info)
  }

  async openVendorInterface(): Promise<HidConnection> {
    const candidates = await this.list()
    const info =
      candidates.find((device) => device.usagePage === VENDOR_USAGE_PAGE) ??
      candidates.find((device) => device.path !== undefined)

    if (!info?.path) {
      throw new Error('No GK6X/Semitek vendor HID interface found')
    }

    return new NodeHidConnection(await this.openHid(info.path), info)
  }
}
