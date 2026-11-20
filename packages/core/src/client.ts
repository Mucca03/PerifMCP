import { COMMAND, INFO, decodeDeviceId, decodeMatrix, decodeModelId, decodeVersion, type VersionInfo } from './protocol/commands.js'
import { PACKET_SIZE, buildPacket, parsePacket, type Packet } from './protocol/packet.js'
import { isCommandAllowed } from './safety.js'
import type { HidConnection } from './transport.js'
import type { DeviceInfo } from './types.js'

export interface ModelRecord {
  ModelID: number
  FWID?: string
  Name?: string
  LEType?: string
}

export interface Gk6xIdentity {
  version: VersionInfo
  deviceId: string
  modelId: number
  matrix: { row: number; column: number }
}

export interface Gk6xClientOptions {
  timeoutMs?: number
  verifyCrc?: boolean
  models?: ModelRecord[]
}

export class Gk6xClient {
  private readonly timeoutMs: number
  private readonly verifyCrc: boolean
  private readonly models: ModelRecord[]

  constructor(
    readonly connection: HidConnection,
    options: Gk6xClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 1500
    this.verifyCrc = options.verifyCrc ?? false
    this.models = options.models ?? []
  }

  async command(
    command: number,
    subCommand = 0,
    header = 0,
    body?: Uint8Array,
    timeoutMs = this.timeoutMs,
  ): Promise<Packet> {
    const packet = buildPacket({ command, subCommand, header, body: body ?? new Uint8Array(0) })
    const response = await this.connection.send(packet, timeoutMs)
    const parsed = parsePacket(response, this.verifyCrc)
    if (parsed.command !== command) {
      throw new Error(`Unexpected response command: expected 0x${command.toString(16)}, got 0x${parsed.command.toString(16)}`)
    }
    return parsed
  }

  /**
   * Sends prebuilt packets (from the encoders in `protocol/`) one by one and checks each response.
   *
   * All packets are checked before the first one is sent: 64 bytes, valid CRC, and a command that
   * `isCommandAllowed('read-write', ...)` accepts, so a bad packet at the end of a sequence cannot leave a
   * half-written table behind. The connection should still be wrapped with `guardConnection`, which
   * enforces the access mode at send time. The response CRC is always verified for writes.
   */
  async writePackets(packets: readonly Uint8Array[], timeoutMs = this.timeoutMs): Promise<void> {
    packets.forEach((raw, index) => {
      if (raw.length !== PACKET_SIZE) {
        throw new RangeError(`packets[${index}] has ${raw.length} bytes, expected ${PACKET_SIZE}`)
      }
      const packet = parsePacket(raw, true)
      if (!isCommandAllowed('read-write', packet.command, packet.subCommand)) {
        throw new RangeError(
          `packets[${index}]: command 0x${packet.command.toString(16)}/0x${packet.subCommand.toString(16)} is not a known write command`,
        )
      }
    })

    for (const raw of packets) {
      const sent = parsePacket(raw)
      const response = parsePacket(await this.connection.send(raw, timeoutMs), true)
      if (response.command !== sent.command) {
        throw new Error(`Unexpected response command: expected 0x${sent.command.toString(16)}, got 0x${response.command.toString(16)}`)
      }
    }
  }

  async ping(timeoutMs = 5000): Promise<void> {
    await this.command(COMMAND.ping, 0, 0, undefined, timeoutMs)
  }

  async version(): Promise<VersionInfo> {
    return decodeVersion(await this.command(COMMAND.info, INFO.version))
  }

  async deviceId(): Promise<string> {
    return decodeDeviceId(await this.command(COMMAND.info, INFO.deviceId))
  }

  async modelId(): Promise<number> {
    return decodeModelId(await this.command(COMMAND.info, INFO.modelId))
  }

  async matrix(): Promise<{ row: number; column: number }> {
    return decodeMatrix(await this.command(COMMAND.info, INFO.matrix))
  }

  async probe(): Promise<Gk6xIdentity> {
    const version = await this.version()
    const deviceId = await this.deviceId()
    const modelId = await this.modelId()
    const matrix = await this.matrix()
    return { version, deviceId, modelId, matrix }
  }

  modelInfo(modelId: number): ModelRecord | undefined {
    return this.models.find((model) => model.ModelID === modelId)
  }

  async info(): Promise<DeviceInfo> {
    const identity = await this.probe()
    const model = this.modelInfo(identity.modelId)
    return {
      vendorId: this.connection.info.vendorId,
      productId: this.connection.info.productId,
      manufacturer: this.connection.info.manufacturer,
      product: this.connection.info.product,
      serialNumber: this.connection.info.serialNumber,
      transport: 'hidraw',
      modelId: identity.modelId,
      modelName: model?.Name,
      firmwareId: identity.version.id,
      firmwareVersion: identity.version.version,
      deviceId: identity.deviceId,
      matrix: identity.matrix,
    }
  }

  close(): Promise<void> {
    return this.connection.close()
  }
}
