import { useMemo, useState } from 'react'
import {
  LIGHTING_EFFECTS,
  LIGHTING_ZONES,
  type HexColor,
  type LightingEffect,
  type LightingPlanInput,
  type LightingState,
  type LightingZone,
} from '@perifmcp/core'
import { describeApiError } from '../api/client'
import { lightingInputToState, rgbToHex, validateChange } from '../api/semantics'
import { useApp } from '../state/app'
import { Button, Field, Panel, Select } from './ui'

export interface LightingDraft {
  effect: LightingEffect
  color: HexColor
  brightness: number
  speed: number
  zones: Partial<Record<LightingZone, HexColor>>
  perKey: Record<string, HexColor>
}

export function draftFromLighting(lighting: LightingState): LightingDraft {
  return {
    effect: lighting.effect,
    color: rgbToHex(lighting.color),
    brightness: lighting.brightness,
    speed: lighting.speed,
    zones: {},
    perKey: {},
  }
}

export function inputFromDraft(draft: LightingDraft): LightingPlanInput {
  const input: LightingPlanInput = {
    effect: draft.effect,
    color: draft.color,
    brightness: draft.brightness,
    speed: draft.speed,
  }
  if (Object.keys(draft.zones).length > 0) input.zones = draft.zones
  if (Object.keys(draft.perKey).length > 0) input.perKey = draft.perKey
  return input
}

/** Lighting the keyboard should draw for an unsent draft. */
export function useDraftLighting(draft: LightingDraft | undefined, current: LightingState | undefined): LightingState | undefined {
  return useMemo(() => (draft && current ? lightingInputToState(current, inputFromDraft(draft)) : undefined), [draft, current])
}

interface Props {
  draft: LightingDraft
  onChange: (draft: LightingDraft) => void
  current: LightingState
}

const EFFECT_NOTES: Partial<Record<LightingEffect, string>> = {
  off: 'Lights are off.',
  'per-key': 'Zone and per-key colors show only with this effect.',
  rainbow: 'Animated. The keyboard preview shows an approximation.',
  wave: 'Animated. The keyboard preview shows an approximation.',
}

export function LightingEditor({ draft, onChange, current }: Props) {
  const { client, layout, selectedKey, registerOwnPlan, setFocusPlanId, refresh } = useApp()
  const [paint, setPaint] = useState<HexColor>('#c084fc')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => lightingInputToState(current, inputFromDraft(draft), layout), [current, draft, layout])
  const errors = useMemo(() => validateChange({ type: 'set-lighting', lighting: preview }, layout), [preview, layout])
  const painted = Object.entries(draft.perKey)

  const set = (patch: Partial<LightingDraft>) => onChange({ ...draft, ...patch })
  /** Painting only shows with the per-key effect, so switch to it visibly. */
  const withPerKey = (patch: Partial<LightingDraft>): Partial<LightingDraft> =>
    draft.effect === 'per-key' ? patch : { ...patch, effect: 'per-key' }

  const submit = async () => {
    if (errors.length > 0) return
    setBusy(true)
    setError(undefined)
    try {
      const plan = await client.planLighting(inputFromDraft(draft))
      registerOwnPlan(plan.id)
      setFocusPlanId(plan.id)
      await refresh()
    } catch (failure) {
      setError(describeApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="lighting editor" id="lighting-editor">
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="effect" hint={EFFECT_NOTES[draft.effect]}>
            <Select value={draft.effect} onChange={(e) => set({ effect: e.target.value as LightingEffect })}>
              {LIGHTING_EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {effect}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="main color" hint="Used by solid, breathing and reactive.">
            <input
              type="color"
              value={draft.color}
              aria-label="Main color"
              onChange={(e) => set({ color: e.target.value as HexColor })}
            />
          </Field>
          <Field label={`brightness: ${draft.brightness}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={draft.brightness}
              aria-label="Brightness percent"
              onChange={(e) => set({ brightness: Number(e.target.value) })}
            />
          </Field>
          <Field label={`speed: ${draft.speed}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={draft.speed}
              aria-label="Speed percent"
              onChange={(e) => set({ speed: Number(e.target.value) })}
            />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs text-gray-400">zones</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LIGHTING_ZONES.map((zone) => {
              const color = draft.zones[zone]
              return (
                <div key={zone} className="flex items-center gap-2 border border-gray-700 p-2 text-xs">
                  <input
                    type="checkbox"
                    id={`zone-${zone}`}
                    checked={color !== undefined}
                    onChange={(e) => {
                      const zones = { ...draft.zones }
                      if (e.target.checked) zones[zone] = paint
                      else delete zones[zone]
                      set(e.target.checked ? withPerKey({ zones }) : { zones })
                    }}
                  />
                  <label htmlFor={`zone-${zone}`} className="flex-1">
                    {zone}
                  </label>
                  <input
                    type="color"
                    aria-label={`Color for zone ${zone}`}
                    disabled={color === undefined}
                    value={color ?? paint}
                    onChange={(e) => set({ zones: { ...draft.zones, [zone]: e.target.value as HexColor } })}
                  />
                </div>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs text-gray-400">per-key colors</legend>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="color"
              value={paint}
              aria-label="Paint color"
              onChange={(e) => setPaint(e.target.value as HexColor)}
            />
            <span className="text-gray-400">selected key: {selectedKey ?? 'none (click a key on the keyboard)'}</span>
            <Button
              disabled={!selectedKey}
              onClick={() => selectedKey && set(withPerKey({ perKey: { ...draft.perKey, [selectedKey]: paint } }))}
            >
              Paint selected key
            </Button>
          </div>
          {painted.length > 0 ? (
            <ul aria-label="Painted keys" className="flex flex-wrap gap-2 text-xs">
              {painted.map(([id, hex]) => (
                <li key={id} className="flex items-center gap-1 border border-gray-700 px-2 py-1">
                  <span aria-hidden="true" className="inline-block size-3 border border-gray-500" style={{ background: hex }} />
                  {id} {hex}
                  <button
                    type="button"
                    className="cursor-pointer text-gray-400 hover:text-brand"
                    aria-label={`Remove painted color for ${id}`}
                    onClick={() => {
                      const perKey = { ...draft.perKey }
                      delete perKey[id]
                      set({ perKey })
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">No per-key colors in this draft.</p>
          )}
        </fieldset>

        {errors.length > 0 ? (
          <ul aria-label="Validation errors" className="text-xs text-amber-200">
            {errors.map((e) => (
              <li key={e}>invalid: {e}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || errors.length > 0}>
            Create plan
          </Button>
          <Button onClick={() => onChange(draftFromLighting(current))}>Reset draft</Button>
          <p className="text-xs text-gray-500">The keyboard above previews this draft. Creating a plan does not touch the keyboard.</p>
        </div>
      </form>
    </Panel>
  )
}
