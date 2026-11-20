import { DEFAULT_LAYOUT } from './layout.js'
import type { KeyAssignment, KeyboardConfig, KeyboardLayout, Layer } from './types.js'

export function createDefaultConfig(layout: KeyboardLayout = DEFAULT_LAYOUT): KeyboardConfig {
  const base: Record<string, KeyAssignment> = {}
  for (const key of layout.keys) {
    base[key.id] = { kind: 'key', code: key.id }
  }

  return {
    layers: {
      base,
      fn1: {},
      fn2: {},
      fn3: {},
    },
    macros: [],
    lighting: {
      enabled: false,
      effect: 'off',
      color: { r: 134, g: 239, b: 172 },
      // Percent, 0-100. Device units are chosen by the encoder.
      brightness: 100,
      speed: 50,
      direction: 0,
      perKey: {},
    },
    settings: {
      nkro: true,
      osMode: 'win',
    },
  }
}

export function cloneConfig(config: KeyboardConfig): KeyboardConfig {
  return JSON.parse(JSON.stringify(config)) as KeyboardConfig
}

export function layerAssignments(
  config: KeyboardConfig,
  layer: Layer,
): Record<string, KeyAssignment> {
  return config.layers[layer]
}

export function assignmentFor(
  config: KeyboardConfig,
  layer: Layer,
  keyId: string,
): KeyAssignment {
  return config.layers[layer][keyId] ?? { kind: 'none' }
}
