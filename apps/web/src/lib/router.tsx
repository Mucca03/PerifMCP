import { useEffect, useState } from 'react'

/**
 * Hash routing (`#/keys`). The UI is a static bundle that can be served by any server
 * (Vite, the daemon, `file://`) without a single-page-app fallback rule.
 */
export const ROUTES = [
  { path: '/keys', title: 'keys' },
  { path: '/macros', title: 'macros' },
  { path: '/lighting', title: 'lighting' },
  { path: '/plans', title: 'plans' },
  { path: '/snapshots', title: 'snapshots' },
] as const

export type RoutePath = (typeof ROUTES)[number]['path']

export const DEFAULT_ROUTE: RoutePath = '/keys'

export function parseHash(hash: string): RoutePath {
  const path = hash.replace(/^#/, '')
  return ROUTES.find((r) => r.path === path)?.path ?? DEFAULT_ROUTE
}

export function useRoute(): RoutePath {
  const [route, setRoute] = useState<RoutePath>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: RoutePath): void {
  window.location.hash = path
}
