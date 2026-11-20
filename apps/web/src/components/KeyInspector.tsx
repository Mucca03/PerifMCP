import { useEffect, useState } from 'react'
import { LAYERS, type KeyAssignment, type Layer, type Modifier } from '@perifmcp/core'
import { describeApiError } from '../api/client'
import { KEY_CODES } from '../api/keys'
import { describeAssignment, validateChange } from '../api/semantics'
import { assignmentSentence } from '../lib/assignment'
import { useApp } from '../state/app'
import { Button, Field, Panel, Select } from './ui'

const MODIFIERS: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'gui']
type Kind = KeyAssignment['kind']
const KINDS: readonly Kind[] = ['key', 'macro', 'layer', 'none']

export function KeyInspector() {
  const { layout, config, layer, selectedKey, client, registerOwnPlan, setFocusPlanId, refresh } = useApp()
  const key = layout?.keys.find((k) => k.id === selectedKey)
  const current: KeyAssignment | undefined = key && config ? config.layers[layer][key.id] : undefined

  const [kind, setKind] = useState<Kind>('key')
  const [code, setCode] = useState('escape')
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  const [macroId, setMacroId] = useState('')
  const [targetLayer, setTargetLayer] = useState<Layer>('fn1')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // Load the form from the stored assignment when the key or layer changes.
  useEffect(() => {
    setErrors([])
    const a = current
    if (a?.kind === 'key') {
      setKind('key')
      setCode(a.code)
      setModifiers(a.modifiers ?? [])
    } else if (a?.kind === 'macro') {
      setKind('macro')
      setMacroId(a.macroId)
    } else if (a?.kind === 'layer') {
      setKind('layer')
      setTargetLayer(a.layer)
    } else if (a?.kind === 'none') {
      setKind('none')
    } else {
      setKind('key')
      setCode(key?.id ?? 'escape')
      setModifiers([])
    }
    // `current` is derived from key, layer and config. Reload only on key or layer change so edits are not overwritten by polling.
  }, [key?.id, layer])

  if (!layout || !config) return null

  if (!key) {
    return (
      <Panel title="key inspector" id="inspector">
        <p className="text-xs text-gray-500">Select a key on the keyboard.</p>
      </Panel>
    )
  }

  const build = (): KeyAssignment => {
    switch (kind) {
      case 'key':
        return modifiers.length > 0 ? { kind: 'key', code, modifiers } : { kind: 'key', code }
      case 'macro':
        return { kind: 'macro', macroId }
      case 'layer':
        return { kind: 'layer', layer: targetLayer }
      case 'none':
        return { kind: 'none' }
    }
  }

  const assignment = build()
  const unchanged = JSON.stringify(assignment) === JSON.stringify(current ?? null)

  const createPlan = async (next: KeyAssignment) => {
    const problems = validateChange({ type: 'set-key', layer, keyId: key.id, assignment: next }, layout)
    setErrors(problems)
    if (problems.length > 0) return
    setBusy(true)
    try {
      const plan = await client.planKeys({ layer, assignments: { [key.id]: next } })
      registerOwnPlan(plan.id)
      setFocusPlanId(plan.id)
      await refresh()
    } catch (error) {
      setErrors([describeApiError(error)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={`key inspector: ${key.label}`} id="inspector">
      <p className="mb-3 text-xs text-gray-400">
        {key.id} on {layer}: {assignmentSentence(current, config)} <span className="text-gray-500">({describeAssignment(current)})</span>
      </p>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void createPlan(assignment)
        }}
      >
        <Field label="assignment">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'key' ? 'key' : k === 'macro' ? 'macro' : k === 'layer' ? 'layer switch' : 'none'}
              </option>
            ))}
          </Select>
        </Field>

        {kind === 'key' ? (
          <>
            <Field label="key code">
              <Select value={code} onChange={(e) => setCode(e.target.value)}>
                {KEY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="flex flex-wrap gap-3 text-xs text-gray-400">
              <legend className="mb-1">modifiers</legend>
              {MODIFIERS.map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={modifiers.includes(m)}
                    onChange={(e) => setModifiers(e.target.checked ? [...modifiers, m] : modifiers.filter((x) => x !== m))}
                  />
                  {m}
                </label>
              ))}
            </fieldset>
          </>
        ) : null}

        {kind === 'macro' ? (
          config.macros.length === 0 ? (
            <p className="text-xs text-gray-500">No macros yet. Create one under /macros.</p>
          ) : (
            <Field label="macro">
              <Select value={macroId} onChange={(e) => setMacroId(e.target.value)}>
                <option value="">choose…</option>
                {config.macros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )
        ) : null}

        {kind === 'layer' ? (
          <Field label="switch to layer">
            <Select value={targetLayer} onChange={(e) => setTargetLayer(e.target.value as Layer)}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {errors.length > 0 ? (
          <ul role="alert" className="text-xs text-red-300">
            {errors.map((e) => (
              <li key={e}>error: {e}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || unchanged}>
            Create plan
          </Button>
          {layer === 'base' ? (
            <Button disabled={busy} onClick={() => void createPlan({ kind: 'key', code: key.id })}>
              Plan reset to default
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-gray-500">Creating a plan does not touch the keyboard. Review and confirm it below.</p>
      </form>
    </Panel>
  )
}
