import type { ApiRoutes, ApiErrorBody } from '@perifmcp/core'

type Res<R extends keyof ApiRoutes> = ApiRoutes[R]['response']
type Body<R extends keyof ApiRoutes> = ApiRoutes[R] extends { body: infer B } ? B : never

/**
 * One typed client, two implementations (`HttpApiClient`, `MockApiClient`).
 * Method signatures come from `ApiRoutes`, so a contract change breaks the build here first.
 */
export interface ApiClient {
  readonly kind: 'http' | 'mock'

  status(): Promise<Res<'GET /api/status'>>
  layout(): Promise<Res<'GET /api/layout'>>
  config(): Promise<Res<'GET /api/config'>>
  macros(): Promise<Res<'GET /api/macros'>>
  lighting(): Promise<Res<'GET /api/lighting'>>

  planKeys(body: Body<'POST /api/plans/keys'>): Promise<Res<'POST /api/plans/keys'>>
  planMacro(body: Body<'POST /api/plans/macro'>): Promise<Res<'POST /api/plans/macro'>>
  planLighting(body: Body<'POST /api/plans/lighting'>): Promise<Res<'POST /api/plans/lighting'>>
  listPlans(): Promise<Res<'GET /api/plans'>>
  previewPlan(id: string): Promise<Res<'GET /api/plans/:id/preview'>>
  applyPlan(id: string, body: Body<'POST /api/plans/:id/apply'>): Promise<Res<'POST /api/plans/:id/apply'>>

  verify(): Promise<Res<'POST /api/verify'>>

  listSnapshots(): Promise<Res<'GET /api/snapshots'>>
  createSnapshot(body: Body<'POST /api/snapshots'>): Promise<Res<'POST /api/snapshots'>>
  restoreSnapshot(id: string, body: Body<'POST /api/snapshots/:id/restore'>): Promise<Res<'POST /api/snapshots/:id/restore'>>
}

/** Error codes from the daemon plus the ones the client itself can produce. */
export type ClientErrorCode = ApiErrorBody['error']['code'] | 'unreachable' | 'bad-response'

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const FRIENDLY: Record<ClientErrorCode, string> = {
  'bad-request': 'The daemon rejected the request as malformed.',
  validation: 'The change is not valid.',
  'confirmation-required': 'Explicit confirmation is required before this action.',
  'forbidden-origin': 'The daemon refused this page origin. Open the UI from the configured address.',
  'write-disabled': 'Writes are disabled. The keyboard is read-only or the model is not recognized.',
  'not-connected': 'No keyboard is connected.',
  'unknown-model': 'The keyboard model is not recognized, so it cannot be written.',
  'plan-stale': 'The keyboard configuration changed after this plan was created. Discard it and create a new plan.',
  'verify-failed': 'The device did not report the expected configuration after writing.',
  'plan-not-found': 'The plan no longer exists. It may have been applied or the daemon restarted.',
  'snapshot-not-found': 'The snapshot no longer exists.',
  'device-error': 'The keyboard returned an error.',
  internal: 'The daemon failed unexpectedly.',
  unreachable: 'The daemon cannot be reached.',
  'bad-response': 'The daemon sent a response the UI cannot read.',
}

/** Text shown to the user. Always includes the code so the cause is never silent. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.message && error.message !== FRIENDLY[error.code] ? ` ${error.message}` : ''
    return `[${error.code}] ${FRIENDLY[error.code]}${detail}`
  }
  if (error instanceof Error) return `[error] ${error.message}`
  return '[error] Unknown error.'
}

export function errorCode(error: unknown): ClientErrorCode | undefined {
  return error instanceof ApiError ? error.code : undefined
}
