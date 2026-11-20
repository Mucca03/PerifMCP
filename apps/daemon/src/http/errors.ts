import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { API_ERROR_STATUS, KeyboardServiceError } from '@perifmcp/core'
import type { ApiErrorBody } from '@perifmcp/core'
import { ZodError } from 'zod'
import { zodIssues } from '../service/util.js'

export type ApiErrorCode = ApiErrorBody['error']['code']

/** An error raised by the HTTP layer itself (bad JSON, forbidden origin, ...). */
export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** Overrides the status from `API_ERROR_STATUS`. */
    readonly status?: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorBody(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } }
}

export interface MappedError {
  status: ContentfulStatusCode
  body: ApiErrorBody
}

/**
 * Maps any thrown value to an API error. Unknown errors become a generic `internal` error:
 * the message and stack are logged server-side (never request bodies) and not sent to the client.
 */
export function mapError(error: unknown): MappedError {
  if (error instanceof KeyboardServiceError) {
    return {
      status: API_ERROR_STATUS[error.code] as ContentfulStatusCode,
      body: errorBody(error.code, error.message, error.details),
    }
  }
  if (error instanceof HttpError) {
    return {
      status: (error.status ?? API_ERROR_STATUS[error.code]) as ContentfulStatusCode,
      body: errorBody(error.code, error.message),
    }
  }
  if (error instanceof ZodError) {
    return {
      status: API_ERROR_STATUS.validation as ContentfulStatusCode,
      body: errorBody('validation', 'Invalid input', { issues: zodIssues(error) }),
    }
  }
  console.error(`internal error: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}`)
  return {
    status: API_ERROR_STATUS.internal as ContentfulStatusCode,
    body: errorBody('internal', 'Internal error'),
  }
}

export function errorResponse(c: Context, error: unknown): Response {
  const { status, body } = mapError(error)
  return c.json(body, status)
}
