import { useMemo, useState } from 'react'
import type { Macro, MacroStep, Modifier } from '@perifmcp/core'
import { describeApiError } from '../api/client'
import { KEY_CODES } from '../api/keys'
import { validateChange } from '../api/semantics'
import { useApp } from '../state/app'
import { Button, Field, Panel, Select, TextInput } from './ui'

const MODIFIERS: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'gui', 'altgr']

type DraftStep = { uid: number } & (
  | { type: 'key'; code: string; modifiers: Modifier[] }
  | { type: 'delay'; ms: string }
)

interface Draft {
  /** Set when editing an existing macro. New macros get an id from the name. */
  id: string | undefined
  name: string
  repeat: string
  steps: DraftStep[]
}

let nextUid = 1
const uid = () => nextUid++

export function emptyDraft(): Draft {
  return { id: undefined, name: '', repeat: '1', steps: [{ uid: uid(), type: 'key', code: 'a', modifiers: [] }] }
}

export function draftFromMacro(macro: Macro): Draft {
  return {
    id: macro.id,
    name: macro.name,
    repeat: String(macro.repeat ?? 1),
    steps: macro.steps.map((s): DraftStep =>
      s.type === 'key'
        ? { uid: uid(), type: 'key', code: s.code, modifiers: s.modifiers ?? [] }
        : { uid: uid(), type: 'delay', ms: String(s.ms) },
    ),
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Builds the macro from the form. Exported for tests. */
export function macroFromDraft(draft: Draft, existingIds: readonly string[]): Macro {
  let id = draft.id
  if (!id) {
    const base = `macro-${slugify(draft.name) || 'untitled'}`
    id = base
    for (let n = 2; existingIds.includes(id); n++) id = `${base}-${n}`
  }
  const steps: MacroStep[] = draft.steps.map((s) =>
    s.type === 'key'
      ? s.modifiers.length > 0
        ? { type: 'key', code: s.code, modifiers: s.modifiers }
        : { type: 'key', code: s.code }
      : { type: 'delay', ms: Number(s.ms) },
  )
  const repeat = Number(draft.repeat)
  return { id, name: draft.name.trim(), steps, repeat }
}

/** Limits that belong to the UI and the daemon, on top of the device rules checked by `validateChange`. */
export const MAX_DELAY_MS = 60_000

export function macroUiErrors(macro: Macro): string[] {
  const errors: string[] = []
  if (macro.name === '') errors.push('The macro needs a name.')
  macro.steps.forEach((step, index) => {
    if (step.type === 'delay' && step.ms > MAX_DELAY_MS) {
      errors.push(`steps[${index}]: delay must be at most ${MAX_DELAY_MS} ms`)
    }
  })
  return errors
}

export function MacroEditor() {
  const { config, layout, client, registerOwnPlan, setFocusPlanId, refresh } = useApp()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const macro = useMemo(
    () => macroFromDraft(draft, config?.macros.map((m) => m.id) ?? []),
    [draft, config?.macros],
  )
  const errors = useMemo(
    () => [...macroUiErrors(macro), ...validateChange({ type: 'set-macro', macro }, layout)],
    [macro, layout],
  )

  if (!config) return <p className="text-xs text-gray-500">Loading macros…</p>

  const updateStep = (id: number, patch: Partial<DraftStep>) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.uid === id ? ({ ...s, ...patch } as DraftStep) : s)) }))
  const move = (index: number, delta: -1 | 1) =>
    setDraft((d) => {
      const steps = [...d.steps]
      const target = index + delta
      const a = steps[index]
      const b = steps[target]
      if (!a || !b) return d
      steps[index] = b
      steps[target] = a
      return { ...d, steps }
    })

  const submit = async () => {
    if (errors.length > 0) return
    setBusy(true)
    setServerError(undefined)
    try {
      const plan = await client.planMacro({ macro })
      registerOwnPlan(plan.id)
      setFocusPlanId(plan.id)
      // Later edits of this form update the same macro instead of creating a copy.
      setDraft((d) => ({ ...d, id: macro.id }))
      await refresh()
    } catch (error) {
      setServerError(describeApiError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <Panel title="macros" id="macro-list">
        <ul className="grid gap-2 text-sm">
          {config.macros.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-pressed={draft.id === m.id}
                onClick={() => setDraft(draftFromMacro(m))}
                className={`w-full cursor-pointer border px-2 py-1 text-left transition-colors hover:border-brand hover:text-brand ${
                  draft.id === m.id ? 'border-brand text-brand' : 'border-gray-700'
                }`}
              >
                {m.name} <span className="text-xs text-gray-500">({m.steps.length} steps)</span>
              </button>
            </li>
          ))}
          {config.macros.length === 0 ? <li className="text-xs text-gray-500">No macros on the keyboard.</li> : null}
        </ul>
        <div className="mt-3">
          <Button onClick={() => setDraft(emptyDraft())}>New macro</Button>
        </div>
      </Panel>

      <Panel title={draft.id ? `edit macro: ${draft.name || draft.id}` : 'new macro'} id="macro-editor">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="name">
              <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} />
            </Field>
            <Field label="repeat (times)">
              <TextInput
                type="number"
                min={1}
                max={255}
                value={draft.repeat}
                onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
              />
            </Field>
          </div>

          <ol className="grid gap-2" aria-label="Macro steps">
            {draft.steps.map((step, index) => (
              <li key={step.uid} className="flex flex-wrap items-end gap-2 border border-gray-700 p-2">
                <span className="w-6 text-xs text-gray-500">{index + 1}.</span>
                <Field label="type">
                  <Select
                    value={step.type}
                    aria-label={`Step ${index + 1} type`}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        steps: d.steps.map((s) =>
                          s.uid !== step.uid
                            ? s
                            : e.target.value === 'delay'
                              ? { uid: s.uid, type: 'delay', ms: '50' }
                              : { uid: s.uid, type: 'key', code: 'a', modifiers: [] },
                        ),
                      }))
                    }
                  >
                    <option value="key">key press</option>
                    <option value="delay">delay</option>
                  </Select>
                </Field>
                {step.type === 'key' ? (
                  <>
                    <Field label="key">
                      <Select
                        value={step.code}
                        aria-label={`Step ${index + 1} key`}
                        onChange={(e) => updateStep(step.uid, { code: e.target.value })}
                      >
                        {KEY_CODES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <fieldset className="flex gap-2 text-xs text-gray-400">
                      <legend className="sr-only">Step {index + 1} modifiers</legend>
                      {MODIFIERS.map((m) => (
                        <label key={m} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={step.modifiers.includes(m)}
                            onChange={(e) =>
                              updateStep(step.uid, {
                                modifiers: e.target.checked ? [...step.modifiers, m] : step.modifiers.filter((x) => x !== m),
                              })
                            }
                          />
                          {m}
                        </label>
                      ))}
                    </fieldset>
                  </>
                ) : (
                  <Field label="delay (ms)">
                    <TextInput
                      type="number"
                      min={1}
                      max={60000}
                      value={step.ms}
                      aria-label={`Step ${index + 1} delay in milliseconds`}
                      onChange={(e) => updateStep(step.uid, { ms: e.target.value })}
                      className="w-28"
                    />
                  </Field>
                )}
                <div className="ml-auto flex gap-1">
                  <Button aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    ↑
                  </Button>
                  <Button
                    aria-label={`Move step ${index + 1} down`}
                    disabled={index === draft.steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.uid !== step.uid) }))}
                  >
                    ×
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                setDraft((d) => ({ ...d, steps: [...d.steps, { uid: uid(), type: 'key', code: 'a', modifiers: [] }] }))
              }
            >
              Add key step
            </Button>
            <Button onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, { uid: uid(), type: 'delay', ms: '50' }] }))}>
              Add delay step
            </Button>
          </div>

          {errors.length > 0 ? (
            <ul aria-label="Validation errors" className="text-xs text-amber-200">
              {errors.map((e) => (
                <li key={e}>invalid: {e}</li>
              ))}
            </ul>
          ) : null}
          {serverError ? (
            <p role="alert" className="text-xs text-red-300">
              {serverError}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="primary" disabled={busy || errors.length > 0}>
              Create plan
            </Button>
            <p className="mt-2 text-xs text-gray-500">
              Macros are typed in by step. Recording is not offered: the UI has no hook for it. Creating a plan does not touch the
              keyboard.
            </p>
          </div>
        </form>
      </Panel>
    </div>
  )
}
