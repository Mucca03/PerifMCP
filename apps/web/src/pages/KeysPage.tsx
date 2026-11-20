import { KeyInspector } from '../components/KeyInspector'
import { ConfigSourceNotice } from '../components/ConfigSourceNotice'
import { KeyboardView } from '../components/KeyboardView'
import { LayerSelector } from '../components/LayerSelector'
import { PlanList } from '../components/PlanList'
import { Panel } from '../components/ui'
import { usePendingView } from '../lib/pending'
import { useApp } from '../state/app'

export function KeysPage() {
  const { layout, config, layer, setLayer, selectedKey, selectKey } = useApp()
  const pending = usePendingView()

  return (
    <div className="grid gap-6">
      <ConfigSourceNotice />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LayerSelector layer={layer} onChange={setLayer} />
        {pending.changedKeys ? (
          <p className="text-xs text-gray-400">
            Showing the pending plan. Keys marked <span className="text-brand">Δ</span> with a dashed border change.
          </p>
        ) : null}
      </div>
      {layout && config ? (
        <KeyboardView
          layout={layout}
          config={config}
          layer={layer}
          selectedKey={selectedKey}
          onSelect={selectKey}
          lighting={pending.lighting}
          changedKeys={pending.changedKeys}
          displayConfig={pending.displayConfig}
        />
      ) : (
        <p className="text-xs text-gray-500">Loading keyboard…</p>
      )}
      <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-2">
        <KeyInspector />
        <Panel title="pending plans" id="plans">
          <PlanList />
        </Panel>
      </div>
    </div>
  )
}
