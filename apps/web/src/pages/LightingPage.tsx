import { useState } from 'react'
import { KeyboardView } from '../components/KeyboardView'
import { LayerSelector } from '../components/LayerSelector'
import { LightingEditor, draftFromLighting, useDraftLighting, type LightingDraft } from '../components/LightingEditor'
import { PlanList } from '../components/PlanList'
import { Panel } from '../components/ui'
import { usePendingView } from '../lib/pending'
import { useApp } from '../state/app'

export function LightingPage() {
  const { layout, config, layer, setLayer, selectedKey, selectKey } = useApp()
  const pending = usePendingView()
  const [draft, setDraft] = useState<LightingDraft>()
  const effectiveDraft = draft ?? (config ? draftFromLighting(config.lighting) : undefined)
  const draftLighting = useDraftLighting(effectiveDraft, config?.lighting)

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LayerSelector layer={layer} onChange={setLayer} />
        <p className="text-xs text-gray-400">
          {pending.lighting ? 'Showing the pending plan.' : 'Showing your unsent draft.'} Color fills are dimmed so labels stay readable.
        </p>
      </div>
      {layout && config ? (
        <KeyboardView
          layout={layout}
          config={config}
          layer={layer}
          selectedKey={selectedKey}
          onSelect={selectKey}
          lighting={pending.lighting ?? draftLighting}
          changedKeys={pending.changedKeys}
          displayConfig={pending.displayConfig}
        />
      ) : (
        <p className="text-xs text-gray-500">Loading keyboard…</p>
      )}
      <div className="mx-auto grid w-full max-w-5xl gap-6">
        {config && effectiveDraft ? <LightingEditor draft={effectiveDraft} onChange={setDraft} current={config.lighting} /> : null}
        <Panel title="pending plans" id="plans">
          <PlanList />
        </Panel>
      </div>
    </div>
  )
}
