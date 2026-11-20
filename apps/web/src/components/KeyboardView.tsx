import { useMemo, useRef, type KeyboardEvent } from 'react'
import type { KeyboardConfig, KeyboardLayout, Layer, LightingState } from '@perifmcp/core'
import { assignmentCapText, assignmentSentence } from '../lib/assignment'
import { capAlpha, cssRgba, keyLightingColor } from '../lib/color'

interface Props {
  layout: KeyboardLayout
  config: KeyboardConfig
  layer: Layer
  selectedKey: string | undefined
  onSelect: (keyId: string) => void
  /** Lighting to draw. Defaults to the config lighting. Pass a pending or draft state to preview it. */
  lighting?: LightingState | undefined
  /** Keys touched by the pending plan. Drawn with a dashed border and a delta marker. */
  changedKeys?: ReadonlySet<string> | undefined
  /** Assignments to draw instead of the config ones (pending plan preview). */
  displayConfig?: KeyboardConfig | undefined
}

type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/** Nearest key in a direction, by key centers. Exported for tests. */
export function neighbor(layout: KeyboardLayout, fromId: string, direction: Direction): string | undefined {
  const from = layout.keys.find((k) => k.id === fromId)
  if (!from) return undefined
  const center = (k: { x: number; y: number; width?: number | undefined }) => ({ x: k.x + (k.width ?? 1) / 2, y: k.y + 0.5 })
  const c = center(from)
  let best: { id: string; score: number } | undefined
  for (const key of layout.keys) {
    if (key.id === fromId) continue
    const p = center(key)
    const dx = p.x - c.x
    const dy = p.y - c.y
    const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight'
    const forward = horizontal ? (direction === 'ArrowRight' ? dx : -dx) : direction === 'ArrowDown' ? dy : -dy
    const side = horizontal ? Math.abs(dy) : Math.abs(dx)
    if (forward <= 0.01) continue
    if (horizontal && side > 0.4) continue
    const score = forward + side * 2
    if (!best || score < best.score) best = { id: key.id, score }
  }
  return best?.id
}

export function KeyboardView({
  layout,
  config,
  layer,
  selectedKey,
  onSelect,
  lighting,
  changedKeys,
  displayConfig,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const shownLighting = lighting ?? config.lighting
  const shownConfig = displayConfig ?? config
  const tabStop = selectedKey ?? layout.keys[0]?.id

  const keys = useMemo(() => layout.keys, [layout])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, keyId: string) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const target = neighbor(layout, keyId, event.key as Direction)
    if (!target) return
    container.current?.querySelector<HTMLButtonElement>(`[data-key-id="${CSS.escape(target)}"]`)?.focus()
  }

  return (
    <div
      ref={container}
      role="group"
      aria-label={`Keyboard, ${layer} layer`}
      className="relative w-full select-none"
      style={{ aspectRatio: `${layout.width} / ${layout.rows}`, containerType: 'inline-size' }}
    >
      {keys.map((key) => {
        const width = key.width ?? 1
        const assignment = shownConfig.layers[layer][key.id]
        const text = assignmentCapText(assignment, key, layout, shownConfig, layer)
        const color = keyLightingColor(shownLighting, key.id, (key.x + width / 2) / layout.width)
        const selected = selectedKey === key.id
        const changed = changedKeys?.has(key.id) ?? false
        const lit = color !== undefined
        const sentence = assignmentSentence(assignment, shownConfig)
        return (
          <div
            key={key.id}
            className="absolute"
            style={{
              left: `${(key.x / layout.width) * 100}%`,
              top: `${(key.y / layout.rows) * 100}%`,
              width: `${(width / layout.width) * 100}%`,
              height: `${100 / layout.rows}%`,
            }}
          >
            <button
              type="button"
              data-key-id={key.id}
              aria-pressed={selected}
              aria-label={`${key.label}, ${sentence}${lit ? ', lit' : ', not lit'}${changed ? ', changed by pending plan' : ''}`}
              tabIndex={key.id === tabStop ? 0 : -1}
              onClick={() => onSelect(key.id)}
              onFocus={() => onSelect(key.id)}
              onKeyDown={(event) => onKeyDown(event, key.id)}
              className={[
                'absolute inset-[2px] flex flex-col items-center justify-center overflow-hidden border text-white transition-colors',
                'cursor-pointer hover:border-brand hover:text-brand',
                selected ? 'border-brand text-brand' : changed ? 'border-brand' : 'border-gray-700',
                changed ? 'border-dashed' : '',
              ].join(' ')}
              style={{
                backgroundColor: color ? cssRgba(color, capAlpha(shownLighting.brightness)) : 'transparent',
                fontSize: 'max(9px, 1.7cqw)',
              }}
            >
              <span className={text === undefined ? '' : 'text-brand'}>{text ?? key.label}</span>
              {text === undefined && key.legend ? <span className="text-[0.75em] text-gray-400">{key.legend}</span> : null}
              {text !== undefined ? <span className="text-[0.7em] text-gray-400">{key.label}</span> : null}
              {changed ? (
                <span aria-hidden="true" className="absolute right-0.5 top-0 text-[0.8em] text-brand">
                  Δ
                </span>
              ) : null}
            </button>
          </div>
        )
      })}
    </div>
  )
}
