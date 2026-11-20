/**
 * UI-only helpers. The shared semantic functions (`applyChanges`, `diffConfig`, `zoneKeys`, ...) now come from
 * `@perifmcp/core` and are re-exported by `semantics.ts`.
 * `lightingInputToState` previews an unsent lighting draft. `describeAssignment` also accepts `undefined`.
 */
import {
  DEFAULT_LAYOUT,
  hexToRgb,
  zoneKeys,
  type HexColor,
  type KeyAssignment,
  type KeyboardLayout,
  type LightingPlanInput,
  type LightingState,
  type LightingZone,
  type RGBColor,
} from '@perifmcp/core'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}


export function describeAssignment(a: KeyAssignment | undefined): string {
  if (!a) return 'unset'
  switch (a.kind) {
    case 'key':
      return a.modifiers && a.modifiers.length > 0 ? `key ${a.modifiers.join('+')}+${a.code}` : `key ${a.code}`
    case 'macro':
      return `macro ${a.macroId}`
    case 'layer':
      return `layer ${a.layer}`
    case 'none':
      return 'none'
  }
}

// --- lighting input -> state (service behavior, mirrored here for the mock and the draft preview) ----

/**
 * Applies a `LightingPlanInput` to the current lighting. The real service owns this mapping; the UI uses it only
 * to preview an unsent draft. Precedence: `base`, then `zones`, then `perKey`. Any of those switches the
 * effect to `per-key` unless `effect` is given.
 */
export function lightingInputToState(
  current: LightingState,
  input: LightingPlanInput,
  layout: KeyboardLayout = DEFAULT_LAYOUT,
): LightingState {
  const next = clone(current)
  const painted: Record<string, RGBColor> = {}
  let usesPerKey = false

  if (input.base) {
    const rgb = hexToRgb(input.base)
    if (rgb) {
      usesPerKey = true
      for (const key of layout.keys) painted[key.id] = rgb
    }
  }
  for (const [zone, hex] of Object.entries(input.zones ?? {}) as [LightingZone, HexColor][]) {
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    usesPerKey = true
    for (const id of zoneKeys(zone, layout)) painted[id] = rgb
  }
  for (const [id, hex] of Object.entries(input.perKey ?? {})) {
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    usesPerKey = true
    painted[id] = rgb
  }
  if (usesPerKey) next.perKey = { ...next.perKey, ...painted }

  if (input.color) {
    const rgb = hexToRgb(input.color)
    if (rgb) next.color = rgb
  }
  if (input.brightness !== undefined) next.brightness = input.brightness
  if (input.speed !== undefined) next.speed = input.speed
  if (input.direction !== undefined) next.direction = input.direction
  if (input.effect) next.effect = input.effect
  else if (usesPerKey) next.effect = 'per-key'
  next.enabled = next.effect !== 'off'
  return next
}
