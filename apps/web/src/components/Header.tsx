import { ROUTES, type RoutePath } from '../lib/router'
import { useTheme } from '../lib/theme'
import { MockApiClient } from '../api/mock-client'
import { useApp } from '../state/app'
import { Badge } from './ui'

export function Header({ route }: { route: RoutePath }) {
  const { theme, cycleTheme } = useTheme()
  const { status, mockReason, client, refresh, connectionError } = useApp()
  const device = status?.device
  const model = device?.modelName ?? device?.product ?? (status?.connection === 'unknown-model' ? 'unknown model' : 'no device')

  return (
    <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div>
        <p className="text-2xl font-bold text-white">perifmcp</p>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-3">
          {ROUTES.map((r) => (
            <a
              key={r.path}
              href={`#${r.path}`}
              aria-current={route === r.path ? 'page' : undefined}
              className={`text-sm transition-colors ${route === r.path ? 'text-brand' : 'text-gray-400 hover:text-brand'}`}
            >
              {r.path}
            </a>
          ))}
          <button
            type="button"
            onClick={cycleTheme}
            aria-label={`Cycle theme, current ${theme.name} (press T)`}
            className="cursor-pointer text-sm text-brand transition-colors"
          >
            {theme.color}
          </button>
        </nav>
      </div>

      <dl className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400" aria-label="Connection">
        <div className="flex gap-1">
          <dt>state</dt>
          <dd className="text-white">{connectionError ? 'daemon error' : (status?.connection ?? 'connecting')}</dd>
        </div>
        <div className="flex gap-1">
          <dt>model</dt>
          <dd className="text-white">{model}</dd>
        </div>
        <div className="flex gap-1">
          <dt>access</dt>
          <dd className={status?.mode === 'read-write' ? 'text-brand' : 'text-amber-200'}>{status?.mode ?? 'unknown'}</dd>
        </div>
        <div className="flex gap-1">
          <dt>transport</dt>
          <dd className="text-white">{status?.transport ?? '-'}</dd>
        </div>
        {mockReason ? (
          <div className="flex items-center gap-2">
            <Badge tone="warn">mock data</Badge>
            {client instanceof MockApiClient ? (
              <button
                type="button"
                className="cursor-pointer text-gray-400 underline hover:text-brand"
                onClick={() => {
                  client.setMode(client.getMode() === 'read-only' ? 'read-write' : 'read-only')
                  void refresh()
                }}
              >
                toggle mock access mode
              </button>
            ) : null}
          </div>
        ) : null}
      </dl>
      {mockReason ? <p className="basis-full text-xs text-gray-500">mock: {mockReason}</p> : null}
    </header>
  )
}
