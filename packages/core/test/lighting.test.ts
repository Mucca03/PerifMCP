import { describe, expect, it } from 'vitest'
import {
  BREATHING_MAX_COLORS,
  LIGHTING_MAX_EFFECTS,
  STATIC_LIGHTING_SLOTS,
  UnsupportedLightingError,
  breathingTiming,
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

  it('refuses effects that are not implemented yet', () => {
    for (const effect of ['rainbow', 'wave', 'reactive'] as const) {
      expect(() => lightingToEffects(lighting({ effect }), map), effect).toThrow(UnsupportedLightingError)
    }
  })

  it('breathes every key in one color when there are no per-key colors', () => {
    const [effect] = lightingToEffects(
      lighting({ effect: 'breathing', color: { r: 255, g: 128, b: 0 }, brightness: 50, speed: 50 }),
      map,
    )
    expect(effect?.type).toBe('dynamic')
    if (effect?.type !== 'dynamic') return
    const everyKey = Object.values(map.location).sort((a, b) => a - b)
    expect(effect.frames).toEqual([{ count: 1, keys: everyKey }])
    expect(effect.params).toHaveLength(1)
    const [param] = effect.params
    expect(param).toMatchObject({ colorType: 2, keys: everyKey, color: { r: 128, g: 64, b: 0, a: 0 } })
    // Speed 50 is a ramp of 19 ticks: value1 = floor(100 / 19), the stay count is 5 like the vendor effects.
    expect(param).toMatchObject({ value1: 5, value2: 5 })
  })

  it('groups per-key colors into one parameter each and leaves other keys dark', () => {
    const red = { r: 255, g: 0, b: 0 }
    const blue = { r: 0, g: 0, b: 255 }
    const [effect] = lightingToEffects(
      lighting({ effect: 'breathing', perKey: { w: red, a: red, s: red, d: blue } }),
      map,
    )
    if (effect?.type !== 'dynamic') throw new Error('expected a dynamic effect')
    const code = (id: string): number => map.location[id] as number
    const byColor = Object.fromEntries(effect.params.map((param) => [`${param.color.r},${param.color.g},${param.color.b}`, param.keys]))
    expect(byColor['255,0,0']).toEqual([code('w'), code('a'), code('s')].sort((x, y) => x - y))
    expect(byColor['0,0,255']).toEqual([code('d')])
    expect(effect.frames[0]?.keys).toEqual([code('w'), code('a'), code('s'), code('d')].sort((x, y) => x - y))
  })

  it('maps speed to the ramp length: a faster speed is a shorter ramp and a larger value1', () => {
    const slow = breathingTiming(0)
    const medium = breathingTiming(50)
    const fast = breathingTiming(100)
    expect([slow.count, medium.count, fast.count]).toEqual([60, 19, 6])
    expect(slow.value1).toBeLessThan(medium.value1)
    expect(medium.value1).toBeLessThan(fast.value1)
    expect(breathingTiming(-20).count).toBe(60)
    expect(breathingTiming(500).count).toBe(6)
  })

  it('refuses a breathing effect with too many different colors', () => {
    const perKey: Record<string, { r: number; g: number; b: number }> = {}
    Object.keys(map.location).slice(0, BREATHING_MAX_COLORS + 1).forEach((id, index) => {
      perKey[id] = { r: index + 1, g: 0, b: 0 }
    })
    expect(() => lightingToEffects(lighting({ effect: 'breathing', perKey }), map)).toThrow(UnsupportedLightingError)
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
