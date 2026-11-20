import { describe, expect, it } from 'vitest'
import {
  LIGHTING_MAX_EFFECTS,
  STATIC_LIGHTING_SLOTS,
  UnsupportedLightingError,
  createDefaultConfig,
  decodeLightingPayload,
  encodeKeyPressEffectPayload,
  encodeLightingPayload,
  lightingToEffects,
  type LightingEffectRecord,
  type LightingState,
} from '../src/index.js'
import { syntheticMap } from './helpers/map.js'

const map = syntheticMap()
const base = createDefaultConfig().lighting
const lighting = (patch: Partial<LightingState>): LightingState => ({ ...base, enabled: true, ...patch })

describe('lightingToEffects', () => {
  it('turns off and disabled lighting into an all-zero static effect', () => {
    expect(lightingToEffects(lighting({ effect: 'off' }), map)).toEqual([{ type: 'static', colors: {} }])
    expect(lightingToEffects(lighting({ effect: 'solid', enabled: false }), map)).toEqual([{ type: 'static', colors: {} }])
  })

  it('lights every mapped key for solid, scaled by brightness', () => {
    const [effect] = lightingToEffects(lighting({ effect: 'solid', color: { r: 255, g: 128, b: 0 }, brightness: 50 }), map)
    expect(effect?.type).toBe('static')
    const colors = effect?.type === 'static' ? effect.colors : {}
    expect(Object.keys(colors)).toHaveLength(64)
    expect(colors[map.location.q as number]).toEqual({ r: 128, g: 64, b: 0, a: 255 })
  })

  it('lights only the listed keys for per-key', () => {
    const [effect] = lightingToEffects(
      lighting({ effect: 'per-key', perKey: { w: { r: 255, g: 0, b: 0 }, a: { r: 0, g: 255, b: 0 } } }),
      map,
    )
    const colors = effect?.type === 'static' ? effect.colors : {}
    expect(Object.keys(colors).map(Number).sort((x, y) => x - y)).toEqual([map.location.w, map.location.a].sort((x, y) => (x as number) - (y as number)))
    expect(colors[map.location.w as number]).toEqual({ r: 255, g: 0, b: 0, a: 255 })
  })

  it('refuses effects that need vendor effect data', () => {
    for (const effect of ['breathing', 'rainbow', 'wave', 'reactive'] as const) {
      expect(() => lightingToEffects(lighting({ effect }), map), effect).toThrow(UnsupportedLightingError)
    }
  })

  it('refuses keys without a location code', () => {
    expect(() => lightingToEffects(lighting({ effect: 'per-key', perKey: { nope: { r: 1, g: 1, b: 1 } } }), map)).toThrow(/location code/)
  })
})

describe('lighting payload', () => {
  const red = { r: 255, g: 0, b: 0, a: 255 }

  it('round-trips several effects and leaves unused table entries at -1', () => {
    const effects: LightingEffectRecord[] = [
      { type: 'static', colors: { 3: red } },
      { type: 'dynamic', frames: [{ count: 1, keys: [1, 2] }, { count: 3, keys: [4] }], params: [] },
      { type: 'static', colors: {} },
    ]
    const payload = encodeLightingPayload(effects)
    expect(decodeLightingPayload(payload)).toEqual(effects)
    expect(Array.from(payload.subarray(3 * 16, 4 * 16))).toEqual(new Array(16).fill(0xff))
  })

  it('rejects out-of-range input', () => {
    expect(() => encodeLightingPayload(Array.from({ length: LIGHTING_MAX_EFFECTS + 1 }, () => ({ type: 'static' as const, colors: {} })))).toThrow(
      /At most 32/,
    )
    expect(() => encodeLightingPayload([{ type: 'static', colors: { [STATIC_LIGHTING_SLOTS]: red } }])).toThrow(/static slots/)
    expect(() => encodeLightingPayload([{ type: 'static', colors: { 0: { ...red, r: 256 } } }])).toThrow(/between 0 and 255/)
    expect(() => encodeLightingPayload([{ type: 'dynamic', frames: [{ count: 1, keys: [176] }], params: [] }])).toThrow(/key mask/)
    expect(() => encodeLightingPayload([{ type: 'dynamic', frames: [{ count: 0, keys: [1] }], params: [] }])).toThrow(/at least 1/)
  })

  it('rejects truncated and unknown data when decoding', () => {
    expect(() => decodeLightingPayload(new Uint8Array(10))).toThrow(/shorter than its table/)
    const payload = encodeLightingPayload([{ type: 'static', colors: {} }])
    payload[512] = 9
    expect(() => decodeLightingPayload(payload)).toThrow(/Unknown lighting data type/)
  })
})

describe('key press effects', () => {
  it('validates effect indexes and keys', () => {
    const small = { logic: { a: 0 }, location: {}, logicSize: 2 }
    expect(() => encodeKeyPressEffectPayload({ a: 32 }, small)).toThrow(/0-31/)
    expect(() => encodeKeyPressEffectPayload({ b: 1 }, small)).toThrow(/No logic code/)
  })
})
