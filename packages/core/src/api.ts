/**
 * HTTP/JSON contract between the web UI and the daemon.
 *
 * Owner: master agent. Frozen before parallel work.
 *
 * The daemon binds to 127.0.0.1 and must reject requests whose `Host` or `Origin`
 * header is not the daemon itself or the configured UI origin (DNS rebinding and
 * cross-site requests from any other web page).
 */
import type { ApplyResult, ConfigPlan, KeyboardConfig, KeyboardLayout, LightingState, Macro } from './types.js'
import type {
  KeyboardStatus,
  KeysPlanInput,
  LightingPlanInput,
  MacroPlanInput,
  PlanPreview,
  RestoreResult,
  ServiceErrorCode,
  SnapshotMeta,
  VerifyResult,
} from './service.js'

/** Not 6464, which the GK6X reference tool uses for its own web GUI. */
export const DEFAULT_DAEMON_PORT = 6465
export const API_PREFIX = '/api'

export interface ApiErrorBody {
  error: {
    code: ServiceErrorCode | 'bad-request' | 'forbidden-origin' | 'internal'
    message: string
    details?: unknown
  }
}

/** HTTP status for each error code. Implemented by the daemon, assumed by the UI. */
export const API_ERROR_STATUS: Record<ApiErrorBody['error']['code'], number> = {
  'bad-request': 400,
  validation: 400,
  'confirmation-required': 400,
  'forbidden-origin': 403,
  'write-disabled': 403,
  'not-connected': 409,
  'unknown-model': 409,
  'plan-stale': 409,
  'verify-failed': 409,
  'plan-not-found': 404,
  'snapshot-not-found': 404,
  'device-error': 502,
  internal: 500,
}

export interface ApiRoutes {
  'GET /api/status': { response: KeyboardStatus }
  'GET /api/layout': { response: KeyboardLayout }
  'GET /api/config': { response: KeyboardConfig }
  'GET /api/macros': { response: Macro[] }
  'GET /api/lighting': { response: LightingState }

  'POST /api/plans/keys': { body: KeysPlanInput; response: ConfigPlan }
  'POST /api/plans/macro': { body: MacroPlanInput; response: ConfigPlan }
  'POST /api/plans/lighting': { body: LightingPlanInput; response: ConfigPlan }
  'GET /api/plans': { response: ConfigPlan[] }
  'GET /api/plans/:id/preview': { response: PlanPreview }
  'POST /api/plans/:id/apply': { body: { confirm: true }; response: ApplyResult }

  'POST /api/verify': { response: VerifyResult }

  'GET /api/snapshots': { response: SnapshotMeta[] }
  'POST /api/snapshots': { body: { reason?: string }; response: SnapshotMeta }
  'POST /api/snapshots/:id/restore': { body: { confirm: true }; response: RestoreResult }
}

export type ApiRoute = keyof ApiRoutes
