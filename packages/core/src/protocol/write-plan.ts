/**
 * Turns config changes into ordered packet lists, and write packets back into semantic records.
 *
 * Pure. Nothing here sends anything. The caller sends `WriteStep.packets` through `Gk6xClient.writePackets`
 * over a `guardConnection` wrapper, after the service has taken a snapshot.
 *
 * Order of writes follows the reference (`GK6X/Program.cs` `map`): for each device layer, lighting, then macros,
 * then key tables; finally a set-layer to the base layer, which the reference calls "required to refresh
 * the keyboard with the updated key info".
 *
 * The device stores whole tables, not single keys. A `set-key` therefore rewrites the full key table
 * of that layer, built from the complete config.
 */
import { cloneConfig } from '../config.js'
import { applyChanges, diffConfig, validateChange } from '../semantics.js'
import type { ConfigDiffEntry } from '../service.js'
import { LAYERS, type ConfigChange, type KeyAssignment, type KeyboardConfig, type KeyboardLayout, type Layer, type Macro } from '../types.js'
import { DEFAULT_LAYER_TARGETS, type LayerTargets } from './driver-value.js'
import { CHUNK_SIZE, DEVICE_LAYER, WRITE_COMMAND, buildSetLayerPacket, type DeviceLayer } from './framing.js'
import { decodeKeySetValues, buildKeySetWrite, encodeKeySetValues, keySetValuesFromPayload, type DecodedKeySet, type KeyIndexMap } from './keyset.js'
import {
  UnsupportedLightingError,
  buildLightingWrite,
  decodeLightingPayload,
  lightingToEffects,
  type LightingEffectRecord,
} from './lighting.js'
import { buildMacroWrite, decodeMacros, encodeMacroPayload } from './macro.js'
import { parsePacket, readU16LE } from './packet.js'

export interface EncodeContext {
  keyIndex: KeyIndexMap
  /** Defaults to `DEFAULT_LAYER_TARGETS`. unverified, see `LayerTarget`. */
  layerTargets?: LayerTargets
  layout?: KeyboardLayout
}

export type WriteStepKind = 'lighting' | 'macros' | 'keys' | 'refresh'

export interface WriteStep {
  kind: WriteStepKind
  deviceLayer: DeviceLayer
  /** Short sentence for logs and the plan preview. */
  description: string
  packets: Uint8Array[]
}

export interface EncodedChanges {
  after: KeyboardConfig
  diff: ConfigDiffEntry[]
  /** Empty whenever `errors` or `unsupported` is not. Nothing is partially encoded. */
  steps: WriteStep[]
  /** Invalid changes (from `validateChange`) and values the encoder rejects (unmapped keys, unknown macros). */
  errors: string[]
  /** Valid changes that cannot be written yet, with the reason. */
  unsupported: string[]
}

interface Dirty {
  layers: Set<Layer>
  macros: boolean
  lighting: boolean
}

function uniqueDeviceLayers(targets: LayerTargets): DeviceLayer[] {
  return [...new Set(LAYERS.map((layer) => targets[layer].layer))].sort((a, b) => a - b)
}

function hasMacroAssignment(entries: Readonly<Record<string, KeyAssignment>>): boolean {
  return Object.values(entries).some((assignment) => assignment.kind === 'macro')
}

function plan(after: KeyboardConfig, diff: ConfigDiffEntry[], context: EncodeContext, all: boolean): Omit<EncodedChanges, 'after' | 'diff'> {
  const targets = context.layerTargets ?? DEFAULT_LAYER_TARGETS
  const errors: string[] = []
  const unsupported: string[] = []

  const dirty: Dirty = { layers: new Set(), macros: all, lighting: all }
  for (const entry of diff) {
    const [section, name] = entry.path.split('.')
    if (section === 'layers' && name !== undefined) dirty.layers.add(name as Layer)
    else if (section === 'macros') dirty.macros = true
    else if (section === 'lighting') dirty.lighting = true
    else if (section === 'settings') {
      unsupported.push(`${entry.path}: the reference tool has no command for keyboard settings`)
    }
  }
  if (all) for (const layer of LAYERS) dirty.layers.add(layer)
  // Macro key values carry the macro's position, so layers that use macros must be rewritten.
  if (dirty.macros) {
    for (const layer of LAYERS) if (hasMacroAssignment(after.layers[layer])) dirty.layers.add(layer)
  }

  const macroIndex = (macroId: string): number | undefined => {
    const index = after.macros.findIndex((macro) => macro.id === macroId)
    return index < 0 ? undefined : index
  }

  const steps: WriteStep[] = []
  const deviceLayers = uniqueDeviceLayers(targets)

  let effects: LightingEffectRecord[] = []
  if (dirty.lighting) {
    try {
      effects = lightingToEffects(after.lighting, context.keyIndex)
    } catch (error) {
      if (error instanceof UnsupportedLightingError) unsupported.push(`lighting.effect: ${error.message}`)
      else errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  let macroPackets: ((layer: DeviceLayer) => Uint8Array[]) | undefined
  if (dirty.macros) {
    try {
      encodeMacroPayload(after.macros)
      macroPackets = (layer) => buildMacroWrite(layer, after.macros)
    } catch (error) {
      errors.push(`macros: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const keyWrites = new Map<Layer, Uint8Array[]>()
  for (const layer of LAYERS) {
    if (!dirty.layers.has(layer)) continue
    try {
      const values = encodeKeySetValues(after.layers[layer], context.keyIndex, { macroIndex, layerTargets: targets })
      keyWrites.set(layer, buildKeySetWrite(targets[layer].layer, values, targets[layer].fn))
    } catch (error) {
      errors.push(`layers.${layer}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length > 0 || unsupported.length > 0) return { steps: [], errors, unsupported }

  for (const deviceLayer of deviceLayers) {
    if (dirty.lighting) {
      steps.push({
        kind: 'lighting',
        deviceLayer,
        description: `write lighting to device layer ${deviceLayer}`,
        packets: buildLightingWrite(deviceLayer, effects),
      })
    }
    if (macroPackets !== undefined) {
      steps.push({
        kind: 'macros',
        deviceLayer,
        description: `write ${after.macros.length} macro(s) to device layer ${deviceLayer}`,
        packets: macroPackets(deviceLayer),
      })
    }
    for (const layer of LAYERS) {
      const packets = keyWrites.get(layer)
      if (packets !== undefined && targets[layer].layer === deviceLayer) {
        steps.push({
          kind: 'keys',
          deviceLayer,
          description: `write ${targets[layer].fn ? 'Fn ' : ''}key table of ${layer} to device layer ${deviceLayer}`,
          packets,
        })
      }
    }
  }

  if (steps.length > 0) {
    // unverified: the reference does this after key writes. It is not known whether lighting-only or macro-only
    // writes need it.
    steps.push({
      kind: 'refresh',
      deviceLayer: DEVICE_LAYER.base,
      description: 'switch to the base layer to refresh the keyboard',
      packets: [buildSetLayerPacket(DEVICE_LAYER.base)],
    })
  }
  return { steps, errors, unsupported }
}

/**
 * Validates `changes`, applies them to `before` and encodes the records that changed.
 * Never throws for bad input: problems are returned in `errors` / `unsupported` and `steps` stays empty.
 */
export function encodeChanges(before: KeyboardConfig, changes: ConfigChange[], context: EncodeContext): EncodedChanges {
  const errors: string[] = []
  changes.forEach((change, index) => {
    for (const message of validateChange(change, context.layout)) errors.push(`changes[${index}]: ${message}`)
  })
  const after = applyChanges(before, changes)
  const diff = diffConfig(before, after)
  if (errors.length > 0) return { after, diff, steps: [], errors, unsupported: [] }
  return { after, diff, ...plan(after, diff, context, false) }
}

/** Encodes every record of a config, regardless of what changed. Used for the first write and for restore. */
export function encodeConfig(config: KeyboardConfig, context: EncodeContext): EncodedChanges {
  const after = cloneConfig(config)
  return { after, diff: [], ...plan(after, [], context, true) }
}

// ---------------------------------------------------------------------------
// Parsing written packets
// ---------------------------------------------------------------------------

export interface ParsedReset {
  kind: 'reset'
  layer: number
  dataType: number
}

export interface ParsedWrite {
  kind: 'write'
  command: number
  layer: number
  /** Whole payload. Padded to 56 bytes when the write was a single packet. */
  payload: Uint8Array
  packetCount: number
}

export interface ParsedSetLayer {
  kind: 'set-layer'
  layer: number
}

export type ParsedRecord = ParsedReset | ParsedWrite | ParsedSetLayer

const LENGTH_BYTE: Readonly<Record<number, number>> = {
  [WRITE_COMMAND.keySet]: 4,
  [WRITE_COMMAND.macros]: 4,
  [WRITE_COMMAND.keyPressLightingEffect]: 4,
  [WRITE_COMMAND.fnKeySet]: 4,
  [WRITE_COMMAND.lighting]: 5,
}

/**
 * Groups a packet list into records: resets, buffered writes (chunks are joined, the last chunk is the first
 * one shorter than 56 bytes) and set-layer. Validates CRCs and chunk offsets. Throws on anything else.
 */
export function parseWriteSequence(packets: readonly Uint8Array[]): ParsedRecord[] {
  const records: ParsedRecord[] = []
  let open: { command: number; layer: number; chunks: Uint8Array[]; length: number; count: number } | undefined

  const close = (): void => {
    if (open === undefined) return
    const payload = new Uint8Array(open.length)
    let cursor = 0
    for (const chunk of open.chunks) {
      payload.set(chunk, cursor)
      cursor += chunk.length
    }
    records.push({ kind: 'write', command: open.command, layer: open.layer, payload, packetCount: open.count })
    open = undefined
  }

  for (const raw of packets) {
    const packet = parsePacket(raw, true)
    const lengthByte = LENGTH_BYTE[packet.command]

    if (lengthByte === undefined) {
      if (open !== undefined) throw new Error('A buffered write ended without its final short chunk')
      if (packet.command === WRITE_COMMAND.reset) {
        records.push({ kind: 'reset', layer: packet.subCommand, dataType: packet.raw[2] ?? 0 })
      } else if (packet.command === WRITE_COMMAND.setLayer) {
        records.push({ kind: 'set-layer', layer: packet.subCommand })
      } else {
        throw new Error(`Unexpected command 0x${packet.command.toString(16)} in a write sequence`)
      }
      continue
    }

    const offset = readU16LE(packet.raw, 2)
    const length = packet.raw[lengthByte] ?? 0
    if (open === undefined) {
      if (offset !== 0) throw new Error(`A buffered write starts at offset ${offset}`)
      if (length === 0) {
        // Single packet: no length on the wire, keep the whole body.
        open = { command: packet.command, layer: packet.subCommand, chunks: [packet.body.slice()], length: packet.body.length, count: 1 }
        close()
        continue
      }
      open = { command: packet.command, layer: packet.subCommand, chunks: [], length: 0, count: 0 }
    }
    if (packet.command !== open.command || packet.subCommand !== open.layer) {
      throw new Error('Packets of one write must share command and layer')
    }
    if (offset !== open.length) throw new Error(`Chunk offset ${offset}, expected ${open.length}`)
    open.chunks.push(packet.body.slice(0, length))
    open.length += length
    open.count += 1
    if (length < CHUNK_SIZE) close()
  }
  if (open !== undefined) throw new Error('A buffered write ended without its final short chunk')
  return records
}

export interface DecodedDeviceState {
  /** Decoded key tables by semantic layer, for the layers whose target table was written. */
  layers: Partial<Record<Layer, DecodedKeySet>>
  macros?: Macro[]
  /** Lighting effect records by device layer. */
  lighting: Partial<Record<number, LightingEffectRecord[]>>
}

export interface DecodeContext extends EncodeContext {
  /** Macro ids by device index. The device does not store them. */
  macroIds?: readonly string[]
}

/** Decodes parsed writes into semantic records, for comparing a read-back or a recorded sequence. */
export function decodeWrites(records: readonly ParsedRecord[], context: DecodeContext): DecodedDeviceState {
  const targets = context.layerTargets ?? DEFAULT_LAYER_TARGETS
  const state: DecodedDeviceState = { layers: {}, lighting: {} }
  const macroIds = context.macroIds ?? []

  for (const record of records) {
    if (record.kind === 'write' && record.command === WRITE_COMMAND.macros) {
      state.macros = decodeMacros(record.payload, macroIds)
    }
  }
  const ids = state.macros?.map((macro) => macro.id) ?? [...macroIds]

  for (const record of records) {
    if (record.kind !== 'write') continue
    if (record.command === WRITE_COMMAND.lighting) {
      state.lighting[record.layer] = decodeLightingPayload(record.payload)
    } else if (record.command === WRITE_COMMAND.keySet || record.command === WRITE_COMMAND.fnKeySet) {
      const fn = record.command === WRITE_COMMAND.fnKeySet
      const values = keySetValuesFromPayload(record.payload, context.keyIndex.logicSize)
      for (const layer of LAYERS) {
        if (targets[layer].layer === record.layer && targets[layer].fn === fn) {
          state.layers[layer] = decodeKeySetValues(values, context.keyIndex, {
            macroId: (index) => ids[index],
            layerTargets: targets,
          })
        }
      }
    }
  }
  return state
}

export interface WriteMismatch {
  index: number
  description: string
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** Compares two packet sequences record by record. An empty result means they carry the same data. */
export function compareWriteSequences(expected: readonly Uint8Array[], actual: readonly Uint8Array[]): WriteMismatch[] {
  const left = parseWriteSequence(expected)
  const right = parseWriteSequence(actual)
  const mismatches: WriteMismatch[] = []
  const count = Math.max(left.length, right.length)

  for (let index = 0; index < count; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) {
      mismatches.push({ index, description: a === undefined ? 'unexpected extra record' : 'missing record' })
    } else if (a.kind !== b.kind) {
      mismatches.push({ index, description: `record kind ${a.kind} != ${b.kind}` })
    } else if (a.kind === 'write' && b.kind === 'write') {
      if (a.command !== b.command || a.layer !== b.layer) {
        mismatches.push({ index, description: `write 0x${a.command.toString(16)}/${a.layer} != 0x${b.command.toString(16)}/${b.layer}` })
      } else if (!equalBytes(a.payload, b.payload)) {
        mismatches.push({ index, description: `payload of 0x${a.command.toString(16)} on layer ${a.layer} differs` })
      }
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      mismatches.push({ index, description: `${a.kind} records differ` })
    }
  }
  return mismatches
}
