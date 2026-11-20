import { useEffect, useState, type ReactNode } from 'react'
import type { ApiClient } from './api/client'
import { selectApiClient } from './api/select'
import { Header } from './components/Header'
import { OutcomeBanner } from './components/OutcomeBanner'
import { ScrambleHeading } from './components/ScrambleHeading'
import { SiteBackground } from './components/SiteBackground'
import { StatusBanners } from './components/StatusBanners'
import { ROUTES, useRoute, type RoutePath } from './lib/router'
import { ThemeProvider } from './lib/theme'
import { KeysPage } from './pages/KeysPage'
import { PlansPage } from './pages/PlansPage'
import { SnapshotsPage } from './pages/SnapshotsPage'
import { AppProvider } from './state/app'

const WIDE_ROUTES: readonly RoutePath[] = ['/keys', '/lighting']

function Page({ route }: { route: RoutePath }): ReactNode {
  switch (route) {
    case '/keys':
      return <KeysPage />
    case '/plans':
      return <PlansPage />
    case '/snapshots':
      return <SnapshotsPage />
    default:
      return null
  }
}

function Shell() {
  const route = useRoute()
  const title = ROUTES.find((r) => r.path === route)?.title ?? 'keys'
  return (
    <>
      <SiteBackground />
      <main className={`relative z-10 mx-auto grid gap-6 px-4 py-10 ${WIDE_ROUTES.includes(route) ? 'max-w-7xl' : 'max-w-5xl'}`}>
        <Header route={route} />
        <StatusBanners />
        <ScrambleHeading trigger={route}>{title}</ScrambleHeading>
        <OutcomeBanner />
        <Page route={route} />
      </main>
    </>
  )
}

export interface AppProps {
  /** Tests inject a client. Otherwise the app picks the daemon or the mock at startup. */
  client?: ApiClient
  mockReason?: string
  pollIntervalMs?: number
}

export function App({ client, mockReason, pollIntervalMs }: AppProps) {
  const [selection, setSelection] = useState<{ client: ApiClient; mockReason?: string } | undefined>(
    client ? { client, ...(mockReason === undefined ? {} : { mockReason }) } : undefined,
  )

  useEffect(() => {
    if (client) return
    let cancelled = false
    void selectApiClient().then((s) => {
      if (!cancelled) setSelection(s)
    })
    return () => {
      cancelled = true
    }
  }, [client])

  return (
    <ThemeProvider>
      {selection ? (
        <AppProvider client={selection.client} mockReason={selection.mockReason} {...(pollIntervalMs === undefined ? {} : { pollIntervalMs })}>
          <Shell />
        </AppProvider>
      ) : (
        <main className="relative z-10 mx-auto max-w-5xl px-4 py-10 text-sm text-gray-400">connecting to the daemon…</main>
      )}
    </ThemeProvider>
  )
}
