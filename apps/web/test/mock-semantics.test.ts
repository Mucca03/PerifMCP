import { DEFAULT_LAYOUT, createDefaultConfig, type ConfigChange } from '@perifmcp/core'
import { describe, expect, it } from 'vitest'
import { KEY_CODES, isKeyCode } from '../src/api/keys'
import {
  applyChanges,
  configRevision,
  diffConfig,
  hexToRgb,
  lightingInputToState,
  rgbToHex,
  validateChange,
  zoneKeys,
} from '../src/api/semantics'

const changes: ConfigChange[] = [
  { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'escape' } },
  { type: 'set-key', layer: 'fn1', keyId: 'q', assignment: { kind: 'layer', layer: 'fn2' } },
]

describe('mock semantics (stand-in for core)', () => {
  it('applyChanges does not mutate and diffConfig reports the changed paths', () => {
    const before = createDefaultConfig()
    const snapshot = JSON.stringify(before)
    const after = applyChanges(before, changes)
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(diffConfig(before, after).map((d) => d.path)).toEqual(['layers.base.capslock', 'layers.fn1.q'])
    expect(diffConfig(before, before)).toEqual([])
  })

  it('revision changes iff the config changes', () => {
    const base = createDefaultConfig()
    expect(configRevision(base)).toBe(configRevision(createDefaultConfig()))
    expect(configRevision(applyChanges(base, changes))).not.toBe(configRevision(base))
  })

  it('every zone is non-empty and only has layout keys', () => {
    const ids = new Set(DEFAULT_LAYOUT.keys.map((k) => k.id))
    for (const zone of ['wasd', 'alphanumeric', 'top-row', 'arrows', 'modifiers'] as const) {
      const keys = zoneKeys(zone)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys.every((k) => ids.has(k))).toBe(true)
    }
  })

  it('validates key codes and macro rules', () => {
    expect(isKeyCode('escape')).toBe(true)
    expect(KEY_CODES).toContain('f1')
    expect(validateChange({ type: 'set-key', layer: 'base', keyId: 'nope', assignment: { kind: 'none' } })).not.toEqual([])
    expect(
      validateChange({ type: 'set-macro', macro: { id: 'm', name: 'm', steps: [{ type: 'key', code: 'zzz' }] } }),
    ).toEqual(['Step 1: unknown key code "zzz".'])
    expect(validateChange({ type: 'set-macro', macro: { id: 'm', name: 'm', steps: [] } })).toEqual([
      'The macro needs at least one step.',
    ])
  })

  it('converts colors and lighting input', () => {
    expect(rgbToHex({ r: 134, g: 239, b: 172 })).toBe('#86efac')
    expect(hexToRgb('#86EFAC')).toEqual({ r: 134, g: 239, b: 172 })
    expect(hexToRgb('red')).toBeUndefined()
    const lighting = lightingInputToState(createDefaultConfig().lighting, { zones: { wasd: '#ff0000' }, perKey: { w: '#00ff00' } })
    expect(lighting.effect).toBe('per-key')
    expect(lighting.perKey.a).toEqual({ r: 255, g: 0, b: 0 })
    expect(lighting.perKey.w).toEqual({ r: 0, g: 255, b: 0 })
  })
})
