import type { LightingState, RGBColor } from '@perifmcp/core'

/** Highest fill opacity of a lighting color on a key cap. Keeps white labels readable. */
export const MAX_CAP_ALPHA = 0.35
const MIN_CAP_ALPHA = 0.06

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(color: RGBColor): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

export function contrastRatio(a: RGBColor, b: RGBColor): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function capAlpha(brightnessPercent: number): number {
  const t = Math.max(0, Math.min(100, brightnessPercent)) / 100
  return MIN_CAP_ALPHA + (MAX_CAP_ALPHA - MIN_CAP_ALPHA) * t
}

/** The color a cap shows over the black page. */
export function blendOnBlack(color: RGBColor, alpha: number): RGBColor {
  return { r: color.r * alpha, g: color.g * alpha, b: color.b * alpha }
}

export function cssRgba(color: RGBColor, alpha: number): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha.toFixed(3)})`
}

function hslToRgb(h: number, s: number, l: number): RGBColor {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

/**
 * Static color of a key for the lighting state. Animated effects (rainbow, wave) show a hue spread by x position,
 * which is an approximation: the real animation cannot be drawn from a snapshot.
 */
export function keyLightingColor(lighting: LightingState, keyId: string, xRatio: number): RGBColor | undefined {
  if (!lighting.enabled || lighting.effect === 'off') return undefined
  switch (lighting.effect) {
    case 'per-key':
      return lighting.perKey[keyId]
    case 'rainbow':
    case 'wave':
      return hslToRgb(Math.round(xRatio * 300), 1, 0.5)
    default:
      return lighting.color
  }
}
