import type { ConfigPlan } from '@perifmcp/core'
import { MAX_PLANS, PLAN_TTL_MS } from '../limits.js'
import { deepFreeze } from './util.js'

export interface PlanStoreOptions {
  ttlMs?: number
  maxPlans?: number
  now?: () => number
}

interface Entry {
  plan: ConfigPlan
  expiresAt: number
  applied: boolean
}

export interface PlanLookup {
  plan: ConfigPlan
  applied: boolean
}

/** In-memory plans. Immutable once stored, expire after the TTL, and the store holds at most `maxPlans`. */
export class PlanStore {
  private readonly entries = new Map<string, Entry>()
  private readonly ttlMs: number
  private readonly maxPlans: number
  private readonly now: () => number

  constructor(options: PlanStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? PLAN_TTL_MS
    this.maxPlans = options.maxPlans ?? MAX_PLANS
    this.now = options.now ?? Date.now
  }

  add(plan: ConfigPlan): ConfigPlan {
    this.purgeExpired()
    while (this.entries.size >= this.maxPlans) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    const frozen = deepFreeze(plan)
    this.entries.set(frozen.id, { plan: frozen, expiresAt: this.now() + this.ttlMs, applied: false })
    return frozen
  }

  /** Includes applied plans until they expire, so callers can tell "already applied" from "unknown". */
  lookup(id: string): PlanLookup | undefined {
    this.purgeExpired()
    const entry = this.entries.get(id)
    return entry ? { plan: entry.plan, applied: entry.applied } : undefined
  }

  markApplied(id: string): void {
    const entry = this.entries.get(id)
    if (entry) entry.applied = true
  }

  /** Unapplied, unexpired plans, newest first. */
  list(): ConfigPlan[] {
    this.purgeExpired()
    return [...this.entries.values()]
      .filter((entry) => !entry.applied)
      .map((entry) => entry.plan)
      .reverse()
  }

  private purgeExpired(): void {
    const now = this.now()
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id)
    }
  }
}
