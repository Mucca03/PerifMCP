import { LAYERS } from '@perifmcp/core'
import type { ConfigChange, KeyAssignment, KeyboardConfig } from '@perifmcp/core'
import { jsonEqual } from './util.js'

const NONE: KeyAssignment = { kind: 'none' }

/**
 * Changes that turn `current` into `target`, changed records only. A key missing from a layer
 * is the same as `{ kind: 'none' }`. Order: macros first (keys may reference them), then keys,
 * lighting and settings, then macro removals (no key references them anymore).
 */
export function configToChanges(current: KeyboardConfig, target: KeyboardConfig): ConfigChange[] {
  const changes: ConfigChange[] = []

  const currentMacros = new Map(current.macros.map((macro) => [macro.id, macro]))
  const targetMacros = new Map(target.macros.map((macro) => [macro.id, macro]))
  for (const [id, macro] of targetMacros) {
    if (!jsonEqual(currentMacros.get(id), macro)) changes.push({ type: 'set-macro', macro })
  }

  for (const layer of LAYERS) {
    const from = current.layers[layer]
    const to = target.layers[layer]
    for (const keyId of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
      const before = from[keyId] ?? NONE
      const after = to[keyId] ?? NONE
      if (!jsonEqual(before, after)) changes.push({ type: 'set-key', layer, keyId, assignment: after })
    }
  }

  if (!jsonEqual(current.lighting, target.lighting)) changes.push({ type: 'set-lighting', lighting: target.lighting })
  if (!jsonEqual(current.settings, target.settings)) changes.push({ type: 'set-settings', settings: target.settings })

  for (const id of currentMacros.keys()) {
    if (!targetMacros.has(id)) changes.push({ type: 'remove-macro', macroId: id })
  }

  return changes
}

/** Key ids whose displayed state changes if `changes` are applied to `config`. */
export function affectedKeyIds(config: KeyboardConfig, changes: readonly ConfigChange[]): string[] {
  const keys = new Set<string>()
  for (const change of changes) {
    switch (change.type) {
      case 'set-key':
        keys.add(change.keyId)
        break
      case 'set-macro':
      case 'remove-macro': {
        const macroId = change.type === 'set-macro' ? change.macro.id : change.macroId
        for (const layer of LAYERS) {
          for (const [keyId, assignment] of Object.entries(config.layers[layer])) {
            if (assignment.kind === 'macro' && assignment.macroId === macroId) keys.add(keyId)
          }
        }
        break
      }
      case 'set-lighting': {
        const before = config.lighting.perKey
        const after = change.lighting.perKey
        for (const keyId of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (!jsonEqual(before[keyId], after[keyId])) keys.add(keyId)
        }
        break
      }
      case 'set-settings':
        break
    }
  }
  return [...keys].sort()
}
