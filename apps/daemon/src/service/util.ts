import { KeyboardServiceError } from '@perifmcp/core'
import type { ZodError } from 'zod'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** Deep copy without keys whose value is `undefined`. */
export function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) result[key] = stripUndefined(child)
    }
    return result
  }
  return value
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export interface ValidationIssue {
  path: string
  message: string
}

export function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map((part) => String(part)).join('.') || '(root)',
    message: issue.message,
  }))
}

export function validationError(issues: ValidationIssue[]): KeyboardServiceError {
  const first = issues[0]
  const message = first ? `Invalid input: ${first.path}: ${first.message}` : 'Invalid input'
  return new KeyboardServiceError('validation', issues.length > 1 ? `${message} (and ${issues.length - 1} more)` : message, {
    issues,
  })
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Runs tasks one at a time, in order. Used to serialize everything that can change the device. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.catch(() => undefined)
    return result
  }
}
