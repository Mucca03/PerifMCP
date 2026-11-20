import { describe, expect, it } from 'vitest'
import {
  GIM_K64_LAYOUT,
  LIGHTING_ZONES,
  applyChanges,
  cloneConfig,
  configRevision,
  createDefaultConfig,
  diffConfig,
  hexToRgb,
  rgbToHex,
  validateChange,
  zoneKeys,
  type ConfigChange,
  type KeyboardConfig,
} from '../src/index.js'

const layoutIds = new Set(GIM_K64_LAYOUT.keys.map((key) => key.id))

const sampleChanges: ConfigChange[] = [
  { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'escape' } },
  { type: 'set-key', layer: 'fn1', keyId: 'q', assignment: { kind: 'key', code: 'c', modifiers: ['ctrl'] } },
  { type: 'set-key', layer: 'fn1', keyId: 'w', assignment: { kind: 'macro', macroId: 'hello' } },
  { type: 'set-key', layer: 'fn2', keyId: 'e', assignment: { kind: 'layer', layer: 'base' } },
  {
    type: 'set-macro',
    macro: {
      id: 'hello',
      name: 'Hello',
      steps: [
        { type: 'key', code: 'h' },
        { type: 'delay', ms: 20 },
        { type: 'key', code: 'i', modifiers: ['shift'] },
      ],
    },
  },
  {
    type: 'set-lighting',
    lighting: {
      enabled: true,
      effect: 'per-key',
      color: { r: 1, g: 2, b: 3 },
      brightness: 80,
      speed: 20,
      direction: 1,
      perKey: { w: { r: 255, g: 0, b: 0 } },
    },
  },
  { type: 'set-settings', settings: { nkro: false, osMode: 'mac', sleepMinutes: 10 } },
]

describe('applyChanges', () => {
  it('does not mutate its input', () => {
    const config = createDefaultConfig()
    const snapshot = JSON.stringify(config)
    const changes = structuredClone(sampleChanges)
    const changesSnapshot = JSON.stringify(changes)
    const next = applyChanges(config, changes)
    expect(JSON.stringify(config)).toBe(snapshot)
    expect(JSON.stringify(changes)).toBe(changesSnapshot)
    expect(next).not.toBe(config)
    // The result does not share nested objects with the changes either.
    const change = changes[1]
    if (change?.type === 'set-key' && change.assignment.kind === 'key') change.assignment.code = 'x'
    expect(next.layers.fn1.q).toEqual({ kind: 'key', code: 'c', modifiers: ['ctrl'] })
  })

  it('replaces a macro with the same id and appends new ones', () => {
    const config = applyChanges(createDefaultConfig(), [
      { type: 'set-macro', macro: { id: 'a', name: 'A', steps: [{ type: 'key', code: 'a' }] } },
      { type: 'set-macro', macro: { id: 'b', name: 'B', steps: [{ type: 'key', code: 'b' }] } },
      { type: 'set-macro', macro: { id: 'a', name: 'A2', steps: [{ type: 'key', code: 'c' }] } },
    ])
    expect(config.macros.map((macro) => [macro.id, macro.name])).toEqual([
      ['a', 'A2'],
      ['b', 'B'],
    ])
    expect(applyChanges(config, [{ type: 'remove-macro', macroId: 'a' }]).macros.map((macro) => macro.id)).toEqual(['b'])
  })

  it('treats a none assignment as a missing entry', () => {
    const next = applyChanges(createDefaultConfig(), [
      { type: 'set-key', layer: 'base', keyId: 'q', assignment: { kind: 'none' } },
    ])
    expect(next.layers.base.q).toBeUndefined()
  })
})

describe('diffConfig', () => {
  it('is empty for equal configs', () => {
    const config = createDefaultConfig()
    expect(diffConfig(config, cloneConfig(config))).toEqual([])
  })

  it('round-trips with applyChanges: applying the diff targets exactly the changed paths', () => {
    const before = createDefaultConfig()
    const after = applyChanges(before, sampleChanges)
    const diff = diffConfig(before, after)
    const paths = diff.map((entry) => entry.path)

    expect(paths).toContain('layers.base.capslock')
    expect(paths).toContain('layers.fn1.q')
    expect(paths).toContain('macros.hello')
    expect(paths).toContain('lighting.effect')
    expect(paths).toContain('lighting.perKey.w')
    expect(paths).toContain('settings.osMode')
    expect(new Set(paths).size).toBe(paths.length)

    // Re-applying the same changes to the result changes nothing.
    expect(diffConfig(after, applyChanges(after, sampleChanges))).toEqual([])
    // Diffing in the other direction reports the same paths.
    expect(diffConfig(after, before).map((entry) => entry.path)).toEqual(paths)
  })

  it('describes a key change in one sentence', () => {
    const before = createDefaultConfig()
    const after = applyChanges(before, [sampleChanges[0] as ConfigChange])
    expect(diffConfig(before, after)).toEqual([
      {
        path: 'layers.base.capslock',
        before: { kind: 'key', code: 'capslock' },
        after: { kind: 'key', code: 'escape' },
        description: 'capslock: key capslock -> key escape',
      },
    ])
  })

  it('does not report none versus a missing entry', () => {
    const before = createDefaultConfig()
    const after = cloneConfig(before)
    after.layers.fn1.q = { kind: 'none' }
    expect(diffConfig(before, after)).toEqual([])
  })

  it('reports macro order changes', () => {
    const base = applyChanges(createDefaultConfig(), [
      { type: 'set-macro', macro: { id: 'a', name: 'A', steps: [{ type: 'key', code: 'a' }] } },
      { type: 'set-macro', macro: { id: 'b', name: 'B', steps: [{ type: 'key', code: 'b' }] } },
    ])
    const swapped = cloneConfig(base)
    swapped.macros.reverse()
    expect(diffConfig(base, swapped).map((entry) => entry.path)).toEqual(['macros.order'])
  })
})

describe('configRevision', () => {
  it('is stable and independent of key order', () => {
    const config = createDefaultConfig()
    const reordered: KeyboardConfig = {
      settings: config.settings,
      lighting: config.lighting,
      macros: config.macros,
      layers: { fn3: {}, fn2: {}, fn1: {}, base: Object.fromEntries(Object.entries(config.layers.base).reverse()) },
    }
    expect(configRevision(config)).toMatch(/^[0-9a-f]{16}$/)
    expect(configRevision(reordered)).toBe(configRevision(config))
    expect(configRevision(cloneConfig(config))).toBe(configRevision(config))
  })

  it('changes if and only if the config changes', () => {
    const config = createDefaultConfig()
    for (const change of sampleChanges) {
      const next = applyChanges(config, [change])
      const changed = diffConfig(config, next).length > 0
      expect(configRevision(next) !== configRevision(config)).toBe(changed)
    }
    // A change that does not alter anything keeps the revision.
    const same = applyChanges(config, [
      { type: 'set-key', layer: 'base', keyId: 'q', assignment: { kind: 'key', code: 'q' } },
      { type: 'set-key', layer: 'fn1', keyId: 'q', assignment: { kind: 'none' } },
    ])
    expect(configRevision(same)).toBe(configRevision(config))
  })
})

describe('zoneKeys', () => {
  it('returns non-empty zones whose ids all exist in the layout', () => {
    for (const zone of LIGHTING_ZONES) {
      const ids = zoneKeys(zone)
      expect(ids.length, zone).toBeGreaterThan(0)
      for (const id of ids) expect(layoutIds.has(id), `${zone}: ${id}`).toBe(true)
    }
  })

  it('matches the documented definitions', () => {
    expect(zoneKeys('wasd')).toEqual(['w', 'a', 's', 'd'])
    expect(zoneKeys('arrows').sort()).toEqual(['arrowdown', 'arrowleft', 'arrowright', 'arrowup'])
    expect(zoneKeys('top-row')).toEqual(GIM_K64_LAYOUT.keys.filter((key) => key.row === 0).map((key) => key.id))
    expect(zoneKeys('alphanumeric')).toHaveLength(36)
    expect(zoneKeys('modifiers')).toEqual(
      GIM_K64_LAYOUT.keys.filter((key) => key.zone === 'modifier').map((key) => key.id),
    )
  })

  it('only returns keys of a custom layout', () => {
    const small = { ...GIM_K64_LAYOUT, keys: GIM_K64_LAYOUT.keys.filter((key) => ['w', 'a'].includes(key.id)) }
    // Layout order: w is on row 1, a on row 2.
    expect(zoneKeys('wasd', small)).toEqual(['w', 'a'])
    expect(zoneKeys('arrows', small)).toEqual([])
  })
})

describe('colors', () => {
  it('parses and formats hex colors', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(hexToRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000')
    expect(rgbToHex({ r: 300, g: -4, b: 7.6 })).toBe('#ff0008')
  })

  it('rejects malformed colors', () => {
    for (const bad of ['', 'ff8000', '#ff80', '#ff80000', '#gg0000', '#ff 000']) {
      expect(hexToRgb(bad), bad).toBeUndefined()
    }
  })

  it('round-trips every channel value', () => {
    for (let value = 0; value < 256; value += 5) {
      const color = { r: value, g: 255 - value, b: (value * 7) % 256 }
      expect(hexToRgb(rgbToHex(color))).toEqual(color)
    }
  })
})

describe('validateChange', () => {
  it('accepts the sample changes', () => {
    for (const change of sampleChanges) expect(validateChange(change), JSON.stringify(change)).toEqual([])
  })

  it('rejects unknown keys, layers and codes', () => {
    expect(validateChange({ type: 'set-key', layer: 'base', keyId: 'nope', assignment: { kind: 'none' } })).toHaveLength(1)
    expect(
      validateChange({ type: 'set-key', layer: 'nope' as 'base', keyId: 'q', assignment: { kind: 'none' } }),
    ).toHaveLength(1)
    expect(
      validateChange({ type: 'set-key', layer: 'base', keyId: 'q', assignment: { kind: 'key', code: 'bogus' } }),
    ).toEqual(['Unknown key code "bogus"'])
    expect(
      validateChange({
        type: 'set-key',
        layer: 'base',
        keyId: 'q',
        assignment: { kind: 'key', code: 'a', modifiers: ['hyper' as 'ctrl'] },
      }),
    ).toHaveLength(1)
  })

  it('protects the fn key', () => {
    const set = (keyId: string, code: string) =>
      validateChange({ type: 'set-key', layer: 'base', keyId, assignment: { kind: 'key', code } })
    expect(set('fn', 'fn')).toEqual([])
    expect(set('fn', 'a')).toHaveLength(1)
    expect(set('q', 'fn')).toHaveLength(1)
    expect(validateChange({ type: 'set-key', layer: 'base', keyId: 'fn', assignment: { kind: 'none' } })).toHaveLength(1)
  })

  it('validates macros', () => {
    const macro = (steps: Array<{ type: 'key'; code: string } | { type: 'delay'; ms: number }>) =>
      validateChange({ type: 'set-macro', macro: { id: 'm', name: 'm', steps } })
    expect(macro([])).toHaveLength(1)
    expect(macro([{ type: 'delay', ms: 5 }])).not.toEqual([])
    expect(macro([{ type: 'delay', ms: 5 }, { type: 'key', code: 'a' }])).toEqual(['A macro cannot start with a delay step'])
    expect(macro([{ type: 'key', code: 'volumeup' }])).toEqual(['steps[0]: volumeup cannot be used in a macro'])
    expect(macro([{ type: 'key', code: 'a' }, { type: 'delay', ms: 70000 }])).toHaveLength(1)
    // 32 key steps expand to 64 device actions, one more than the 63 slots.
    expect(macro(Array.from({ length: 32 }, () => ({ type: 'key' as const, code: 'a' })))).toHaveLength(1)
    expect(macro(Array.from({ length: 31 }, () => ({ type: 'key' as const, code: 'a' })))).toEqual([])
    expect(validateChange({ type: 'set-macro', macro: { id: '', name: 'x', steps: [{ type: 'key', code: 'a' }] } })).toHaveLength(1)
    expect(
      validateChange({ type: 'set-macro', macro: { id: 'm', name: 'x', repeat: 0, steps: [{ type: 'key', code: 'a' }] } }),
    ).toHaveLength(1)
  })

  it('validates lighting and settings', () => {
    const good = createDefaultConfig().lighting
    expect(validateChange({ type: 'set-lighting', lighting: good })).toEqual([])
    expect(validateChange({ type: 'set-lighting', lighting: { ...good, brightness: 180 } })).toHaveLength(1)
    expect(validateChange({ type: 'set-lighting', lighting: { ...good, speed: -1 } })).toHaveLength(1)
    expect(validateChange({ type: 'set-lighting', lighting: { ...good, effect: 'disco' as 'off' } })).toHaveLength(1)
    expect(validateChange({ type: 'set-lighting', lighting: { ...good, color: { r: 256, g: 0, b: 0 } } })).toHaveLength(1)
    expect(validateChange({ type: 'set-lighting', lighting: { ...good, perKey: { nope: { r: 0, g: 0, b: 0 } } } })).toHaveLength(1)
    expect(validateChange({ type: 'set-settings', settings: { nkro: true, osMode: 'win' } })).toEqual([])
    expect(validateChange({ type: 'set-settings', settings: { nkro: true, osMode: 'linux' as 'win' } })).toHaveLength(1)
    expect(validateChange({ type: 'remove-macro', macroId: '' })).toHaveLength(1)
  })
})

describe('createDefaultConfig', () => {
  it('uses percent units for lighting', () => {
    const { lighting } = createDefaultConfig()
    expect(lighting.brightness).toBe(100)
    expect(lighting.speed).toBe(50)
    expect(validateChange({ type: 'set-lighting', lighting })).toEqual([])
  })

  it('assigns every layout key to itself on the base layer', () => {
    const config = createDefaultConfig()
    for (const key of GIM_K64_LAYOUT.keys) {
      expect(config.layers.base[key.id]).toEqual({ kind: 'key', code: key.id })
    }
  })
})
