import { useMemo } from 'react'
import type { KeyboardConfig, LightingState } from '@perifmcp/core'
import { applyChanges } from '../api/semantics'
import { useApp } from '../state/app'

export interface PendingView {
  /** Config after the focused plan, or `undefined` when no plan is focused. */
  displayConfig: KeyboardConfig | undefined
  lighting: LightingState | undefined
  changedKeys: ReadonlySet<string> | undefined
}

/** What the keyboard should draw to show the focused plan before it is applied. */
export function usePendingView(): PendingView {
  const { config, focusPreview } = useApp()
  return useMemo(() => {
    if (!config || !focusPreview) return { displayConfig: undefined, lighting: undefined, changedKeys: undefined }
    const after = applyChanges(config, focusPreview.plan.changes)
    return { displayConfig: after, lighting: after.lighting, changedKeys: new Set(focusPreview.affectedKeys) }
  }, [config, focusPreview])
}
