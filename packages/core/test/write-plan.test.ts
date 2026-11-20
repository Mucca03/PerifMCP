import { describe, expect, it } from 'vitest'
import {
  DEVICE_LAYER,
  WRITE_COMMAND,
  applyChanges,
  compareWriteSequences,
  createDefaultConfig,
  decodeWrites,
  diffConfig,
  encodeChanges,
  encodeConfig,
  parseWriteSequence,
  isCommandAllowed,
  parsePacket,
  type ConfigChange,
  type KeyboardConfig,
  type WriteStep,
} from '../src/index.js'
import { syntheticMap } from './helpers/map.js'

const keyIndex = syntheticMap()
const context = { keyIndex }
const flat = (steps: WriteStep[]): Uint8Array[] => steps.flatMap((step) => step.packets)
const summary = (steps: WriteStep[]): string[] => steps.map((step) => `${step.kind}@${step.deviceLayer}`)

describe('encodeConfig', () => {
  const config = createDefaultConfig()
  const result = encodeConfig(config, context)

  it('writes lighting, macros and key tables for each device layer, then refreshes', () => {
    expect(result.errors).toEqual([])
    expect(result.unsupported).toEqual([])
    expect(summary(result.steps)).toEqual([
      'lighting@1', 'macros@1', 'keys@1',
      'lighting@2', 'macros@2', 'keys@2',
      'lighting@3', 'macros@3', 'keys@3',
      'lighting@4', 'macros@4', 'keys@4',
      'refresh@1',
    ])
  })

  it('only uses commands that safety.ts allows in read-write mode', () => {
    for (const packet of flat(result.steps)) {
      const parsed = parsePacket(packet, true)
      expect(isCommandAllowed('read-write', parsed.command, parsed.subCommand), `0x${parsed.command.toString(16)}`).toBe(true)
      expect(isCommandAllowed('read-only', parsed.command, parsed.subCommand)).toBe(false)
      expect([0x03, 0x41]).not.toContain(parsed.command)
    }
  })

  it('decodes back to the config it was built from', () => {
    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)
    const expectedBase = { ...config.layers.base }
    delete expectedBase.fn
    expect(state.layers.base?.assignments).toEqual(expectedBase)
    expect(state.layers.fn1?.assignments).toEqual({})
    expect(state.macros).toEqual([])
    expect(Object.keys(state.lighting).map(Number)).toEqual([1, 2, 3, 4])
    expect(state.lighting[1]).toEqual([{ type: 'static', colors: {} }])
  })
})

describe('encodeChanges', () => {
  const before = createDefaultConfig()

  it('rewrites only the key table that changed', () => {
    const change: ConfigChange = { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'escape' } }
    const result = encodeChanges(before, [change], context)
    expect(result.errors).toEqual([])
    expect(summary(result.steps)).toEqual(['keys@1', 'refresh@1'])
    expect(result.diff.map((entry) => entry.path)).toEqual(['layers.base.capslock'])

    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)
    expect(state.layers.base?.assignments.capslock).toEqual({ kind: 'key', code: 'escape' })
    expect(state.layers.base?.assignments.q).toEqual({ kind: 'key', code: 'q' })
  })

  it('writes a layer-switch key to the table of its layer', () => {
    const result = encodeChanges(before, [{ type: 'set-key', layer: 'fn2', keyId: 'q', assignment: { kind: 'layer', layer: 'base' } }], context)
    expect(summary(result.steps)).toEqual(['keys@3', 'refresh@1'])
    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)
    expect(state.layers.fn2?.assignments).toEqual({ q: { kind: 'layer', layer: 'base' } })
  })

  it('writes the macro table to every device layer and the key tables that reference macros', () => {
    const changes: ConfigChange[] = [
      {
        type: 'set-macro',
        macro: { id: 'greet', name: 'greet', steps: [{ type: 'key', code: 'h' }, { type: 'delay', ms: 10 }, { type: 'key', code: 'i' }] },
      },
      { type: 'set-key', layer: 'fn1', keyId: 'q', assignment: { kind: 'macro', macroId: 'greet' } },
    ]
    const result = encodeChanges(before, changes, context)
    expect(result.errors).toEqual([])
    expect(summary(result.steps)).toEqual(['macros@1', 'macros@2', 'keys@2', 'macros@3', 'macros@4', 'refresh@1'])

    const state = decodeWrites(parseWriteSequence(flat(result.steps)), { ...context, macroIds: ['greet'] })
    expect(state.macros?.map((macro) => macro.id)).toEqual(['greet'])
    expect(state.macros?.[0]?.steps).toEqual(changes[0] && changes[0].type === 'set-macro' ? changes[0].macro.steps : [])
    expect(state.layers.fn1?.assignments.q).toEqual({ kind: 'macro', macroId: 'greet' })
  })

  it('rewrites macro users when a macro is removed, which fails if a key still points at it', () => {
    const withMacro = applyChanges(before, [
      { type: 'set-macro', macro: { id: 'm', name: 'm', steps: [{ type: 'key', code: 'a' }] } },
      { type: 'set-key', layer: 'base', keyId: 'q', assignment: { kind: 'macro', macroId: 'm' } },
    ])
    const result = encodeChanges(withMacro, [{ type: 'remove-macro', macroId: 'm' }], context)
    expect(result.steps).toEqual([])
    expect(result.errors).toEqual(['layers.base: Unknown macro "m"'])
  })

  it('encodes a lighting change for every device layer', () => {
    const result = encodeChanges(
      before,
      [{ type: 'set-lighting', lighting: { ...before.lighting, enabled: true, effect: 'solid', color: { r: 9, g: 8, b: 7 } } }],
      context,
    )
    expect(summary(result.steps)).toEqual(['lighting@1', 'lighting@2', 'lighting@3', 'lighting@4', 'refresh@1'])
    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)
    const effect = state.lighting[DEVICE_LAYER.base]?.[0]
    expect(effect?.type === 'static' ? effect.colors[keyIndex.location.q as number] : undefined).toEqual({ r: 9, g: 8, b: 7, a: 255 })
  })

  it('returns nothing to write when nothing changed', () => {
    const result = encodeChanges(before, [{ type: 'set-key', layer: 'base', keyId: 'q', assignment: { kind: 'key', code: 'q' } }], context)
    expect(result.steps).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.diff).toEqual([])
  })

  it('does not encode partially: unsupported changes empty the step list', () => {
    const changes: ConfigChange[] = [
      { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'escape' } },
      { type: 'set-settings', settings: { nkro: false, osMode: 'win' } },
    ]
    const result = encodeChanges(before, changes, context)
    expect(result.steps).toEqual([])
    expect(result.unsupported).toEqual(['settings.nkro: the reference tool has no command for keyboard settings'])

    const wave = encodeChanges(before, [{ type: 'set-lighting', lighting: { ...before.lighting, enabled: true, effect: 'wave' } }], context)
    expect(wave.steps).toEqual([])
    expect(wave.unsupported).toHaveLength(1)
    expect(wave.unsupported[0]).toMatch(/^lighting\.effect: Lighting effect "wave"/)
  })

  it('encodes breathing to every device layer and decodes it back', () => {
    const breathing: ConfigChange = {
      type: 'set-lighting',
      lighting: { ...before.lighting, enabled: true, effect: 'breathing', color: { r: 134, g: 239, b: 172 }, speed: 50 },
    }
    const result = encodeChanges(before, [breathing], context)
    expect(result.errors).toEqual([])
    expect(result.unsupported).toEqual([])
    expect(summary(result.steps)).toEqual(['lighting@1', 'lighting@2', 'lighting@3', 'lighting@4', 'refresh@1'])
    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)
    const effects = state.lighting[DEVICE_LAYER.base] ?? []
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ type: 'dynamic', params: [{ colorType: 2, color: { r: 134, g: 239, b: 172, a: 0 }, value1: 5, value2: 5 }] })
  })

  it('reports invalid changes and unmapped keys', () => {
    const invalid = encodeChanges(before, [{ type: 'set-key', layer: 'base', keyId: 'nope', assignment: { kind: 'none' } }], context)
    expect(invalid.steps).toEqual([])
    expect(invalid.errors).toEqual(['changes[0]: Unknown key id "nope"'])

    const sparse = { ...keyIndex, logic: { ...keyIndex.logic } }
    delete sparse.logic.capslock
    const unmapped = encodeChanges(before, [{ type: 'set-key', layer: 'base', keyId: 'a', assignment: { kind: 'key', code: 'b' } }], { keyIndex: sparse })
    expect(unmapped.steps).toEqual([])
    expect(unmapped.errors).toEqual(['layers.base: No logic code for key(s): capslock'])
  })

  it('honours custom layer targets', () => {
    const layerTargets = {
      base: { layer: DEVICE_LAYER.base, fn: false },
      fn1: { layer: DEVICE_LAYER.base, fn: true },
      fn2: { layer: DEVICE_LAYER.layer1, fn: false },
      fn3: { layer: DEVICE_LAYER.layer1, fn: true },
    } as const
    const result = encodeChanges(before, [{ type: 'set-key', layer: 'fn1', keyId: 'q', assignment: { kind: 'key', code: 'f1' } }], { keyIndex, layerTargets })
    expect(summary(result.steps)).toEqual(['keys@1', 'refresh@1'])
    const records = parseWriteSequence(flat(result.steps))
    expect(records.map((record) => (record.kind === 'write' ? record.command : record.kind))).toEqual(['reset', WRITE_COMMAND.fnKeySet, 'set-layer'])
    expect(decodeWrites(records, { keyIndex, layerTargets }).layers.fn1?.assignments).toEqual({ q: { kind: 'key', code: 'f1' } })
  })
})

describe('remap on top of firmware defaults', () => {
  const firmware = createDefaultConfig()
  firmware.layers.base = {}
  const menuToAt: ConfigChange = {
    type: 'set-key',
    layer: 'base',
    keyId: 'menu',
    assignment: { kind: 'key', code: 'q', modifiers: ['altgr'] },
  }
  const keyTableWords = (steps: WriteStep[]): number[] => {
    const write = steps.find((step) => step.kind === 'keys')
    const packets = (write?.packets ?? []).filter((packet) => packet[0] === WRITE_COMMAND.keySet)
    const words: number[] = []
    for (const packet of packets) {
      for (let offset = 8; offset + 4 <= 64; offset += 4) {
        words.push(((packet[offset] ?? 0) | ((packet[offset + 1] ?? 0) << 8) | ((packet[offset + 2] ?? 0) << 16) | ((packet[offset + 3] ?? 0) << 24)) >>> 0)
      }
    }
    // The last packet is padded with zeros. The table is the first `logicSize` words.
    return words.slice(0, keyIndex.logicSize)
  }

  it('sets only the named key and leaves every other entry as the firmware default', () => {
    const result = encodeChanges(firmware, [menuToAt], context)
    expect(result.errors).toEqual([])
    expect(summary(result.steps)).toEqual(['keys@1', 'refresh@1'])
    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)
    expect(state.layers.base?.assignments).toEqual({ menu: { kind: 'key', code: 'q', modifiers: ['altgr'] } })
    const words = keyTableWords(result.steps)
    expect(words).toHaveLength(keyIndex.logicSize)
    expect(words.filter((word) => word !== 0xffffffff)).toEqual([0x02001440])
    expect(words[keyIndex.logic.menu ?? -1]).toBe(0x02001440)
  })

  it('goes back to the firmware defaults by setting the key to none', () => {
    const remapped = encodeChanges(firmware, [menuToAt], context).after
    const revert = encodeChanges(remapped, [{ type: 'set-key', layer: 'base', keyId: 'menu', assignment: { kind: 'none' } }], context)
    expect(revert.errors).toEqual([])
    expect(summary(revert.steps)).toEqual(['keys@1', 'refresh@1'])
    const state = decodeWrites(parseWriteSequence(flat(revert.steps)), context)
    expect(state.layers.base?.assignments).toEqual({})
    const words = keyTableWords(revert.steps)
    expect(words).toHaveLength(keyIndex.logicSize)
    expect(words.every((word) => word === 0xffffffff)).toBe(true)
  })
})

describe('apply then decode', () => {
  it('reproduces the changed config for supported changes (device view of the diff)', () => {
    const before = createDefaultConfig()
    const changes: ConfigChange[] = [
      { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'lctrl' } },
      { type: 'set-key', layer: 'base', keyId: 'e', assignment: { kind: 'key', code: 'e', modifiers: ['alt', 'gui'] } },
      { type: 'set-key', layer: 'fn3', keyId: 'x', assignment: { kind: 'key', code: 'volumeup' } },
    ]
    const result = encodeChanges(before, changes, context)
    const state = decodeWrites(parseWriteSequence(flat(result.steps)), context)

    const device: KeyboardConfig = createDefaultConfig()
    for (const layer of ['base', 'fn3'] as const) {
      const assignments = state.layers[layer]?.assignments ?? {}
      device.layers[layer] = layer === 'base' ? { ...before.layers.base, ...assignments } : assignments
    }
    expect(diffConfig(result.after, device)).toEqual([])
  })
})

describe('compareWriteSequences', () => {
  const config = createDefaultConfig()
  const a = flat(encodeConfig(config, context).steps)

  it('is empty for equal sequences', () => {
    expect(compareWriteSequences(a, flat(encodeConfig(config, context).steps))).toEqual([])
  })

  it('names the record that differs', () => {
    const changed = applyChanges(config, [{ type: 'set-key', layer: 'base', keyId: 'q', assignment: { kind: 'key', code: 'w' } }])
    const mismatches = compareWriteSequences(a, flat(encodeConfig(changed, context).steps))
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]?.description).toMatch(/payload of 0x22 on layer 1 differs/)
  })

  it('reports missing and extra records', () => {
    const shorter = a.slice(0, a.length - 1)
    expect(compareWriteSequences(a, shorter)).toEqual([{ index: parseWriteSequence(a).length - 1, description: 'missing record' }])
  })
})

describe('parseWriteSequence', () => {
  it('rejects unexpected commands, bad CRCs and truncated writes', () => {
    const steps = encodeConfig(createDefaultConfig(), context).steps
    const keys = steps.find((step) => step.kind === 'keys')?.packets ?? []
    expect(() => parseWriteSequence(keys.slice(0, -1))).toThrow(/final short chunk/)
    expect(() => parseWriteSequence([keys[1] as Uint8Array, keys[3] as Uint8Array])).toThrow(/offset/)
    const corrupt = (keys[2] as Uint8Array).slice()
    corrupt[20] = (corrupt[20] ?? 0) ^ 0xff
    expect(() => parseWriteSequence([corrupt])).toThrow(/CRC/)
    expect(() => parseWriteSequence([new Uint8Array(64).fill(0).map((_, i) => (i === 0 ? 0x01 : 0))])).toThrow()
  })
})
