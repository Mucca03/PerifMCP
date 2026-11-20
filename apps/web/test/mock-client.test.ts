import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { MockApiClient } from '../src/api/mock-client'

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    return error instanceof ApiError ? error.code : 'other'
  }
  return undefined
}

describe('MockApiClient obeys the service rules', () => {
  it('applies a plan after preview with confirm, takes a snapshot first and changes the revision', async () => {
    const api = new MockApiClient({ seedAgentPlan: false })
    const before = (await api.status()).configRevision
    const plan = await api.planKeys({ layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } })
    const preview = await api.previewPlan(plan.id)
    expect(preview.diff.map((d) => d.path)).toEqual(['layers.base.capslock'])
    expect(preview.affectedKeys).toEqual(['capslock'])
    const result = await api.applyPlan(plan.id, { confirm: true })
    expect(result).toMatchObject({ applied: true, verified: true })
    expect(result.snapshotId).toBeDefined()
    expect((await api.listSnapshots()).map((s) => s.id)).toContain(result.snapshotId)
    expect((await api.status()).configRevision).not.toBe(before)
    expect((await api.config()).layers.base.capslock).toEqual({ kind: 'key', code: 'escape' })
    expect(await api.listPlans()).toEqual([])
  })

  it('rejects apply without confirm, with write-disabled, and for unknown plans', async () => {
    const api = new MockApiClient({ seedAgentPlan: false, mode: 'read-only' })
    const plan = await api.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    expect(await code(api.applyPlan(plan.id, { confirm: false as unknown as true }))).toBe('confirmation-required')
    expect(await code(api.applyPlan(plan.id, { confirm: true }))).toBe('write-disabled')
    expect(await code(api.createSnapshot({}))).toBe('write-disabled')
    expect((await api.status()).writeDisabledReasons.length).toBeGreaterThan(0)
    api.setMode('read-write')
    expect(await code(api.applyPlan('plan-999', { confirm: true }))).toBe('plan-not-found')
  })

  it('reports plan-stale when the revision changed after the plan was made', async () => {
    const api = new MockApiClient({ seedAgentPlan: false })
    const a = await api.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    const b = await api.planKeys({ layer: 'base', assignments: { b: { kind: 'none' } } })
    await api.applyPlan(a.id, { confirm: true })
    expect(await code(api.applyPlan(b.id, { confirm: true }))).toBe('plan-stale')
  })

  it('validates plans and restores snapshots with a safety snapshot', async () => {
    const api = new MockApiClient({ seedAgentPlan: false })
    expect(await code(api.planKeys({ layer: 'base', assignments: { a: { kind: 'key', code: 'nope' } } }))).toBe('validation')
    expect(await code(api.planKeys({ layer: 'base', assignments: { a: { kind: 'macro', macroId: 'missing' } } }))).toBe('validation')
    const original = await api.config()
    const snap = await api.createSnapshot({ reason: 'start' })
    const plan = await api.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    await api.applyPlan(plan.id, { confirm: true })
    expect(await code(api.restoreSnapshot(snap.id, { confirm: false as unknown as true }))).toBe('confirmation-required')
    const restored = await api.restoreSnapshot(snap.id, { confirm: true })
    expect(restored.safetySnapshotId).toBeDefined()
    expect(await api.config()).toEqual(original)
    expect(await code(api.restoreSnapshot('snap-none', { confirm: true }))).toBe('snapshot-not-found')
  })

  it('reports verified false with mismatches when a failure is queued', async () => {
    const api = new MockApiClient({ seedAgentPlan: false })
    const plan = await api.planLighting({ brightness: 50 })
    api.queueVerifyFailure()
    const result = await api.applyPlan(plan.id, { confirm: true })
    expect(result).toMatchObject({ applied: true, verified: false })
    const verify = await api.verify()
    expect(verify.ok).toBe(false)
    expect(verify.mismatches.length).toBeGreaterThan(0)
  })
})
