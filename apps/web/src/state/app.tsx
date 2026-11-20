import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  ConfigDiffEntry,
  ConfigPlan,
  KeyboardConfig,
  KeyboardLayout,
  KeyboardStatus,
  Layer,
  PlanPreview,
  SnapshotMeta,
} from '@perifmcp/core'
import { describeApiError, type ApiClient } from '../api/client'

export const POLL_INTERVAL_MS = 3000

/** Result of the last apply or restore, shown in an `aria-live` region on every page. */
export interface Outcome {
  kind: 'apply' | 'restore'
  label: string
  applied: boolean
  verified: boolean
  errors: string[]
  snapshotId?: string | undefined
  /** From `POST /api/verify`, fetched when `verified` is false. */
  mismatches: ConfigDiffEntry[]
  verifyError?: string | undefined
}

export interface AppState {
  client: ApiClient
  /** Set when the mock is used, with the reason. */
  mockReason: string | undefined
  loaded: boolean
  /** Last polling or loading error, shown in the header area. Cleared on the next success. */
  connectionError: string | undefined
  layout: KeyboardLayout | undefined
  config: KeyboardConfig | undefined
  status: KeyboardStatus | undefined
  plans: ConfigPlan[]
  snapshots: SnapshotMeta[]

  writeEnabled: boolean
  writeReasons: string[]

  layer: Layer
  setLayer: (layer: Layer) => void
  selectedKey: string | undefined
  selectKey: (id: string | undefined) => void

  /** Plan shown on the keyboard overlay and expanded in the plan panel. */
  focusPlanId: string | undefined
  /** `GET /api/plans/:id/preview` for the focused plan. */
  focusPreview: PlanPreview | undefined
  focusPreviewError: string | undefined
  setFocusPlanId: (id: string | undefined) => void
  /** Plans created from this UI session. Others are labelled as coming from an agent. */
  ownPlanIds: ReadonlySet<string>
  registerOwnPlan: (id: string) => void
  /** Plans hidden locally. The API has no way to delete a plan. */
  dismissedPlanIds: ReadonlySet<string>
  dismissPlan: (id: string) => void

  outcome: Outcome | undefined
  setOutcome: (outcome: Outcome | undefined) => void

  refresh: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({
  client,
  mockReason,
  pollIntervalMs = POLL_INTERVAL_MS,
  children,
}: {
  client: ApiClient
  mockReason?: string | undefined
  pollIntervalMs?: number
  children: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const [connectionError, setConnectionError] = useState<string>()
  const [layout, setLayout] = useState<KeyboardLayout>()
  const [config, setConfig] = useState<KeyboardConfig>()
  const [status, setStatus] = useState<KeyboardStatus>()
  const [plans, setPlans] = useState<ConfigPlan[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [layer, setLayer] = useState<Layer>('base')
  const [selectedKey, selectKey] = useState<string>()
  const [focusPlanId, setFocusPlanId] = useState<string>()
  const [focusPreview, setFocusPreview] = useState<PlanPreview>()
  const [focusPreviewError, setFocusPreviewError] = useState<string>()
  const [ownPlanIds, setOwnPlanIds] = useState<ReadonlySet<string>>(new Set())
  const [dismissedPlanIds, setDismissedPlanIds] = useState<ReadonlySet<string>>(new Set())

  const [outcome, setOutcome] = useState<Outcome>()

  const revisionRef = useRef<string | undefined>(undefined)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** One load or poll cycle. `full` also reloads layout, config and snapshots. */
  const load = useCallback(
    async (full: boolean) => {
      try {
        const [nextStatus, nextPlans] = await Promise.all([client.status(), client.listPlans()])
        const revisionChanged = nextStatus.configRevision !== revisionRef.current
        let nextLayout: KeyboardLayout | undefined
        let nextConfig: KeyboardConfig | undefined
        let nextSnapshots: SnapshotMeta[] | undefined
        if (full) nextLayout = await client.layout()
        if (full || revisionChanged) {
          ;[nextConfig, nextSnapshots] = await Promise.all([client.config(), client.listSnapshots()])
        }
        if (!aliveRef.current) return
        revisionRef.current = nextStatus.configRevision
        setStatus(nextStatus)
        setPlans(nextPlans)
        if (nextLayout) setLayout(nextLayout)
        if (nextConfig) setConfig(nextConfig)
        if (nextSnapshots) setSnapshots(nextSnapshots)
        setConnectionError(undefined)
        setLoaded(true)
      } catch (error) {
        if (!aliveRef.current) return
        setConnectionError(describeApiError(error))
        setLoaded(true)
      }
    },
    [client],
  )

  const refresh = useCallback(() => load(true), [load])

  useEffect(() => {
    void load(true)
    // Poll while the tab is visible. No WebSocket or SSE in the contract.
    const tick = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    const timer = setInterval(tick, pollIntervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load, pollIntervalMs])

  // Load the diff for the focused plan. Reload when the config revision changes so a stale plan shows its error.
  const revision = status?.configRevision
  useEffect(() => {
    setFocusPreview(undefined)
    setFocusPreviewError(undefined)
    if (!focusPlanId) return
    let cancelled = false
    client.previewPlan(focusPlanId).then(
      (preview) => {
        if (!cancelled) setFocusPreview(preview)
      },
      (error: unknown) => {
        if (!cancelled) setFocusPreviewError(describeApiError(error))
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, focusPlanId, revision])

  const registerOwnPlan = useCallback((id: string) => setOwnPlanIds((prev) => new Set(prev).add(id)), [])
  const dismissPlan = useCallback(
    (id: string) => {
      setDismissedPlanIds((prev) => new Set(prev).add(id))
      setFocusPlanId((current) => (current === id ? undefined : current))
    },
    [],
  )

  const value = useMemo<AppState>(
    () => ({
      client,
      mockReason,
      loaded,
      connectionError,
      layout,
      config,
      status,
      plans,
      snapshots,
      writeEnabled: status?.writeEnabled ?? false,
      writeReasons: status
        ? status.writeDisabledReasons
        : ['The daemon status is not available.'],
      layer,
      setLayer,
      selectedKey,
      selectKey,
      focusPlanId,
      focusPreview,
      focusPreviewError,
      setFocusPlanId,
      ownPlanIds,
      registerOwnPlan,
      dismissedPlanIds,
      dismissPlan,
      outcome,
      setOutcome,
      refresh,
    }),
    [
      client, mockReason, loaded, connectionError, layout, config, status, plans, snapshots, layer,
      selectedKey, focusPlanId, focusPreview, focusPreviewError, ownPlanIds, registerOwnPlan, dismissedPlanIds, dismissPlan, outcome, refresh,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
