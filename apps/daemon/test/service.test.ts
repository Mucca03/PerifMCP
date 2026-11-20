import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ConfigPlan, KeyboardConfig } from '@perifmcp/core'
import { configRevision, diffConfig } from '@perifmcp/core'
import { expectServiceError, makeRig, makeTempDir } from './helpers.js'

const escapeForCaps = { layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } } as const

async function planCapsToEscape(rig: Awaited<ReturnType<typeof makeRig>>): Promise<ConfigPlan> {
  return rig.service.planKeys({ layer: 'base', assignments: { capslock: { kind: 'key', code: 'escape' } } })
}

describe('status', () => {
  it('reports read-only mode and why writes are off by default', async () => {
    const { service } = await makeRig()
    const status = await service.status()

    expect(status.connection).toBe('connected')
    expect(status.transport).toBe('mock')
    expect(status.mode).toBe('read-only')
    expect(status.writeEnabled).toBe(false)
    expect(status.writeDisabledReasons.join(' ')).toMatch(/PERIFMCP_ALLOW_WRITES/)
    expect(status.device?.serialNumber).toBeUndefined()
    expect(status.configRevision).toBe(configRevision(await service.getConfig()))
  })

  it('enables writes only when allowed, model known and backend supports writes', async () => {
    expect((await (await makeRig({ allowWrites: true })).service.status()).writeEnabled).toBe(true)

    const unknown = await (await makeRig({ allowWrites: true, backend: { modelKnown: false } })).service.status()
    expect(unknown.writeEnabled).toBe(false)
    expect(unknown.connection).toBe('unknown-model')
    expect(unknown.writeDisabledReasons.join(' ')).toMatch(/model/)

    const noWrites = await (await makeRig({ allowWrites: true, backend: { supportsWrites: false } })).service.status()
    expect(noWrites.writeEnabled).toBe(false)
    expect(noWrites.writeDisabledReasons.join(' ')).toMatch(/backend/)
  })

  it('reports a disconnected keyboard and rejects reads with not-connected', async () => {
    const { service } = await makeRig({ backend: { connected: false } })
    const status = await service.status()
    expect(status.connection).toBe('disconnected')
    expect(status.writeEnabled).toBe(false)
    await expectServiceError(service.getConfig(), 'not-connected')
    await expectServiceError(service.planKeys(escapeForCaps), 'not-connected')
  })

  it('still answers when the config cannot be read', async () => {
    const rig = await makeRig()
    rig.backend.failReads = new Error('boom')
    const status = await rig.service.status()
    expect(status.configRevision).toBe('unavailable')
    await expectServiceError(rig.service.getConfig(), 'device-error')
  })
})

describe('reads', () => {
  it('returns layers, macros and lighting from the device', async () => {
    const { service } = await makeRig()
    const config = await service.getConfig()
    expect(await service.getLayer('base')).toEqual(config.layers.base)
    expect(await service.getMacros()).toEqual([])
    expect(await service.getLighting()).toEqual(config.lighting)
    expect((await service.getLayout()).keyCount).toBe(64)
  })
})

describe('planning', () => {
  it('creates an immutable plan bound to the current revision and never writes', async () => {
    const rig = await makeRig({ allowWrites: true })
    const status = await rig.service.status()
    const plan = await planCapsToEscape(rig)

    expect(plan.baseRevision).toBe(status.configRevision)
    expect(plan.deviceId).toBe('mock-gim-k64')
    expect(plan.requiresConfirmation).toBe(true)
    expect(plan.changes).toEqual([
      { type: 'set-key', layer: 'base', keyId: 'capslock', assignment: { kind: 'key', code: 'escape' } },
    ])
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.changes)).toBe(true)
    expect(() => {
      ;(plan.changes as unknown[]).push({})
    }).toThrow()
    expect(rig.backend.writes).toHaveLength(0)
    expect(await rig.service.listPlans()).toEqual([plan])
  })

  it('leaves unchanged assignments out and warns', async () => {
    const rig = await makeRig()
    const plan = await rig.service.planKeys({
      layer: 'base',
      assignments: { capslock: { kind: 'key', code: 'capslock' } },
    })
    expect(plan.changes).toEqual([])
    expect(plan.warnings.join(' ')).toMatch(/No changes/)
  })

  it('rejects invalid input with validation errors', async () => {
    const { service } = await makeRig()
    const bad = (input: unknown): Promise<unknown> => service.planKeys(input as never)
    await expectServiceError(bad({ layer: 'base', assignments: { nokey: { kind: 'none' } } }), 'validation')
    await expectServiceError(bad({ layer: 'fn9', assignments: { a: { kind: 'none' } } }), 'validation')
    await expectServiceError(bad({ layer: 'base', assignments: { a: { kind: 'key', code: 'nope' } } }), 'validation')
    await expectServiceError(bad({ layer: 'base', assignments: {} }), 'validation')
    await expectServiceError(
      bad({ layer: 'base', assignments: { a: { kind: 'macro', macroId: 'missing' } } }),
      'validation',
    )
    await expectServiceError(service.planLighting({ base: 'red' as never }), 'validation')
    await expectServiceError(service.planLighting({ speed: 101 }), 'validation')
    await expectServiceError(service.planLighting({}), 'validation')
  })

  it('plans a macro and warns when it replaces one', async () => {
    const rig = await makeRig({ allowWrites: true })
    const macro = { id: 'hello', name: 'Hello', steps: [{ type: 'key', code: 'h' }, { type: 'delay', ms: 10 }] } as const
    const first = await rig.service.planMacro({ macro: structuredClone(macro) as never })
    expect(first.changes).toHaveLength(1)
    await rig.service.applyPlan(first.id, true)

    const again = await rig.service.planMacro({ macro: structuredClone(macro) as never })
    expect(again.changes).toEqual([])
    const changed = await rig.service.planMacro({
      macro: { id: 'hello', name: 'Hello 2', steps: [{ type: 'key', code: 'h' }] },
    })
    expect(changed.warnings.join(' ')).toMatch(/Replaces/)
  })

  it('rejects macros that break the limits', async () => {
    const { service } = await makeRig()
    const steps = Array.from({ length: 257 }, () => ({ type: 'delay', ms: 1 }) as const)
    await expectServiceError(service.planMacro({ macro: { id: 'm', name: 'm', steps } }), 'validation')
    await expectServiceError(
      service.planMacro({ macro: { id: 'm', name: 'm', steps: [{ type: 'delay', ms: 60001 }] } }),
      'validation',
    )
    await expectServiceError(
      service.planMacro({ macro: { id: 'm', name: 'm', steps: [{ type: 'delay', ms: 1 }], repeat: 1001 } }),
      'validation',
    )
    await expectServiceError(
      service.planMacro({ macro: { id: 'bad id!', name: 'm', steps: [{ type: 'delay', ms: 1 }] } }),
      'validation',
    )
  })

  it('merges base, zones and per-key colors in that order and switches to the per-key effect', async () => {
    const { service } = await makeRig()
    const plan = await service.planLighting({
      base: '#000000',
      zones: { wasd: '#ff0000', arrows: '#00ff00' },
      perKey: { w: '#0000ff' },
      brightness: 80,
    })
    const change = plan.changes[0]
    if (change?.type !== 'set-lighting') throw new Error('expected set-lighting')
    const { lighting } = change
    expect(lighting.effect).toBe('per-key')
    expect(lighting.enabled).toBe(true)
    expect(lighting.brightness).toBe(80)
    expect(lighting.perKey.q).toEqual({ r: 0, g: 0, b: 0 })
    expect(lighting.perKey.a).toEqual({ r: 255, g: 0, b: 0 })
    expect(lighting.perKey.w).toEqual({ r: 0, g: 0, b: 255 })
    expect(lighting.perKey.arrowup).toEqual({ r: 0, g: 255, b: 0 })
    expect(Object.keys(lighting.perKey)).toHaveLength(64)
  })

  it('breathes in the main color and drops stored key colors when the request gives none', async () => {
    const rig = await makeRig({ allowWrites: true })
    // A profile with 64 per-key colors is already stored, like after applying a gradient.
    const profile = await rig.service.planLighting({ base: '#1e1e2e', perKey: { escape: '#f38ba8' } })
    await rig.service.applyPlan(profile.id, true)

    const plan = await rig.service.planLighting({ effect: 'breathing', color: '#86efac', speed: 40 })
    const change = plan.changes[0]
    if (change?.type !== 'set-lighting') throw new Error('expected set-lighting')
    expect(change.lighting.effect).toBe('breathing')
    expect(change.lighting.enabled).toBe(true)
    expect(change.lighting.color).toEqual({ r: 134, g: 239, b: 172 })
    expect(change.lighting.speed).toBe(40)
    expect(change.lighting.perKey).toEqual({})
    expect(plan.warnings.join(' ')).toMatch(/stored per-key colors were cleared/)
  })

  it('uses the colors of the request as breathing groups', async () => {
    const { service } = await makeRig()
    const plan = await service.planLighting({ effect: 'breathing', zones: { wasd: '#ff0000' }, base: '#0000ff' })
    const change = plan.changes[0]
    if (change?.type !== 'set-lighting') throw new Error('expected set-lighting')
    expect(change.lighting.effect).toBe('breathing')
    expect(Object.keys(change.lighting.perKey)).toHaveLength(64)
    expect(change.lighting.perKey.w).toEqual({ r: 255, g: 0, b: 0 })
    expect(plan.warnings.join(' ')).not.toMatch(/does not use per-key colors/)
  })

  it('warns when a breathing plan has more colors than the keyboard accepts', async () => {
    const { service } = await makeRig()
    const perKey: Record<string, `#${string}`> = {}
    const keys = ['escape', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'a', 's', 'd', 'f', 'g', 'h']
    keys.forEach((id, index) => {
      perKey[id] = `#${(index + 1).toString(16).padStart(2, '0')}0000`
    })
    const plan = await service.planLighting({ effect: 'breathing', perKey })
    expect(plan.warnings.join(' ')).toMatch(/at most 16 different colors/)
  })

  it('warns when the lighting effect is off', async () => {
    const { service } = await makeRig()
    const plan = await service.planLighting({ speed: 10 })
    expect(plan.warnings.join(' ')).toMatch(/off/)
  })

  it('expires plans after the TTL and caps the store', async () => {
    let now = 1_000_000
    const rig = await makeRig({ plans: { ttlMs: 1000, maxPlans: 2, now: () => now } })
    const first = await planCapsToEscape(rig)
    const second = await rig.service.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    const third = await rig.service.planKeys({ layer: 'base', assignments: { b: { kind: 'none' } } })

    expect((await rig.service.listPlans()).map((plan) => plan.id)).toEqual([third.id, second.id])
    await expectServiceError(rig.service.previewPlan(first.id), 'plan-not-found')

    now += 1001
    expect(await rig.service.listPlans()).toEqual([])
    await expectServiceError(rig.service.previewPlan(third.id), 'plan-not-found')
  })
})

describe('preview', () => {
  it('shows the diff and the affected keys without touching the device', async () => {
    const rig = await makeRig()
    const plan = await planCapsToEscape(rig)
    const preview = await rig.service.previewPlan(plan.id)

    expect(preview.affectedKeys).toEqual(['capslock'])
    expect(preview.diff).toHaveLength(1)
    expect(preview.diff[0]?.path).toBe('layers.base.capslock')
    expect(rig.backend.writes).toHaveLength(0)
    await expectServiceError(rig.service.previewPlan('does-not-exist'), 'plan-not-found')
  })

  it('flags a stale plan', async () => {
    const rig = await makeRig({ allowWrites: true })
    const first = await planCapsToEscape(rig)
    const second = await rig.service.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    await rig.service.applyPlan(second.id, true)

    const preview = await rig.service.previewPlan(first.id)
    expect(preview.plan.warnings.join(' ')).toMatch(/stale/)
    expect(first.warnings.join(' ')).not.toMatch(/stale/)
  })
})

describe('apply, verify and restore', () => {
  it('runs plan -> preview -> apply -> verify -> restore on the mock backend', async () => {
    const rig = await makeRig({ allowWrites: true })
    const original = await rig.service.getConfig()

    const plan = await planCapsToEscape(rig)
    await rig.service.previewPlan(plan.id)
    const result = await rig.service.applyPlan(plan.id, true)

    expect(result).toMatchObject({ planId: plan.id, applied: true, verified: true, errors: [] })
    expect(result.snapshotId).toBeTruthy()
    expect((await rig.service.getLayer('base')).capslock).toEqual({ kind: 'key', code: 'escape' })
    expect(rig.backend.writes).toEqual([plan.changes])
    expect(await rig.service.listPlans()).toEqual([])
    expect(await rig.service.verify()).toEqual({ ok: true, mismatches: [] })

    const snapshots = await rig.service.listSnapshots()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({ id: result.snapshotId, planId: plan.id })

    const restored = await rig.service.restore(result.snapshotId ?? '', true)
    expect(restored).toMatchObject({ snapshotId: result.snapshotId, applied: true, verified: true, errors: [] })
    expect(restored.safetySnapshotId).toBeTruthy()
    expect(restored.safetySnapshotId).not.toBe(result.snapshotId)
    expect(await rig.service.getConfig()).toEqual(original)
    expect(await rig.service.listSnapshots()).toHaveLength(2)

    // The safety snapshot makes the restore reversible.
    await rig.service.restore(restored.safetySnapshotId ?? '', true)
    expect((await rig.service.getLayer('base')).capslock).toEqual({ kind: 'key', code: 'escape' })
  })

  it('applies a lighting plan and restores macros', async () => {
    const rig = await makeRig({ allowWrites: true })
    const original = await rig.service.getConfig()
    const macroPlan = await rig.service.planMacro({
      macro: { id: 'm1', name: 'M1', steps: [{ type: 'key', code: 'a' }] },
    })
    const macroResult = await rig.service.applyPlan(macroPlan.id, true)
    const keyPlan = await rig.service.planKeys({ layer: 'fn1', assignments: { q: { kind: 'macro', macroId: 'm1' } } })
    expect(keyPlan.changes).toHaveLength(1)
    await rig.service.applyPlan(keyPlan.id, true)
    const lightPlan = await rig.service.planLighting({ effect: 'rainbow', brightness: 40 })
    const lightResult = await rig.service.applyPlan(lightPlan.id, true)
    expect(lightResult).toMatchObject({ applied: true, verified: true })
    expect((await rig.service.getLighting()).effect).toBe('rainbow')

    const restored = await rig.service.restore(macroResult.snapshotId ?? '', true)
    expect(restored.verified).toBe(true)
    // Absent keys and `none` are the same assignment, so compare semantically.
    expect(diffConfig(original, await rig.service.getConfig())).toEqual([])
  })

  it('requires confirm === true before anything else, even when writes are disabled', async () => {
    const rig = await makeRig()
    const plan = await planCapsToEscape(rig)
    for (const bad of [undefined, false, 'true', 1, null]) {
      await expectServiceError(rig.service.applyPlan(plan.id, bad as never), 'confirmation-required')
      await expectServiceError(rig.service.restore('x', bad as never), 'confirmation-required')
    }
    expect(rig.backend.writes).toHaveLength(0)
  })

  it('refuses to write when writes are disabled, without snapshot or write', async () => {
    const rig = await makeRig()
    const plan = await planCapsToEscape(rig)
    const error = await expectServiceError(rig.service.applyPlan(plan.id, true), 'write-disabled')
    expect(error.message).toMatch(/PERIFMCP_ALLOW_WRITES/)
    await expectServiceError(rig.service.restore('00000000-0000-4000-8000-000000000000', true), 'write-disabled')
    expect(rig.backend.writes).toHaveLength(0)
    expect(await readdir(rig.stateDir)).toEqual([])
    expect(await rig.service.listPlans()).toHaveLength(1)
  })

  it('refuses to write for an unknown model or a backend without write support', async () => {
    for (const backend of [{ modelKnown: false }, { supportsWrites: false }]) {
      const rig = await makeRig({ allowWrites: true, backend })
      const plan = await planCapsToEscape(rig)
      await expectServiceError(rig.service.applyPlan(plan.id, true), 'write-disabled')
      expect(rig.backend.writes).toHaveLength(0)
    }
  })

  it('reports plan-not-found and plan-stale', async () => {
    const rig = await makeRig({ allowWrites: true })
    await expectServiceError(rig.service.applyPlan('nope', true), 'plan-not-found')

    const first = await planCapsToEscape(rig)
    const second = await rig.service.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    await rig.service.applyPlan(second.id, true)
    await expectServiceError(rig.service.applyPlan(first.id, true), 'plan-stale')
    await expectServiceError(rig.service.applyPlan(second.id, true), 'plan-stale')
    expect(rig.backend.writes).toHaveLength(1)
  })

  it('does not apply when the snapshot cannot be saved', async () => {
    const dir = await makeTempDir()
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'a file where the snapshot folder should be')
    const rig = await makeRig({ allowWrites: true, stateDir: blocker })
    const plan = await planCapsToEscape(rig)

    await expectServiceError(rig.service.applyPlan(plan.id, true), 'device-error')
    expect(rig.backend.writes).toHaveLength(0)
    expect(await rig.service.listPlans()).toHaveLength(1)
  })

  it('takes the snapshot before the write', async () => {
    const rig = await makeRig({ allowWrites: true })
    const order: string[] = []
    const save = rig.snapshots.save.bind(rig.snapshots)
    rig.snapshots.save = async (...args) => {
      order.push('snapshot')
      return save(...args)
    }
    const write = rig.backend.writeChanges.bind(rig.backend)
    rig.backend.writeChanges = async (changes) => {
      order.push('write')
      return write(changes)
    }
    const plan = await planCapsToEscape(rig)
    await rig.service.applyPlan(plan.id, true)
    expect(order).toEqual(['snapshot', 'write'])
  })

  it('reports a failed verification without deleting the snapshot or restoring automatically', async () => {
    const rig = await makeRig({ allowWrites: true })
    rig.backend.tamper = (config: KeyboardConfig) => {
      config.layers.base.capslock = { kind: 'key', code: 'tab' }
      return config
    }
    const plan = await planCapsToEscape(rig)
    const result = await rig.service.applyPlan(plan.id, true)

    expect(result.applied).toBe(true)
    expect(result.verified).toBe(false)
    expect(result.errors.join(' ')).toMatch(/capslock/)
    expect(rig.backend.writes).toHaveLength(1)
    expect((await rig.service.getLayer('base')).capslock).toEqual({ kind: 'key', code: 'tab' })
    expect(await rig.service.listSnapshots()).toHaveLength(1)

    const verify = await rig.service.verify()
    expect(verify.ok).toBe(false)
    expect(verify.mismatches[0]?.path).toBe('layers.base.capslock')
  })

  it('reports a failed write as not applied and keeps the snapshot', async () => {
    const rig = await makeRig({ allowWrites: true })
    rig.backend.failNextWrite = new Error('device timeout')
    const plan = await planCapsToEscape(rig)
    const result = await rig.service.applyPlan(plan.id, true)

    expect(result.applied).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.errors.join(' ')).toMatch(/device timeout/)
    expect(result.snapshotId).toBeTruthy()
    expect(await rig.service.listSnapshots()).toHaveLength(1)
  })

  it('serializes concurrent applies so only one wins', async () => {
    const rig = await makeRig({ allowWrites: true })
    const first = await planCapsToEscape(rig)
    const second = await rig.service.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    const results = await Promise.allSettled([rig.service.applyPlan(first.id, true), rig.service.applyPlan(second.id, true)])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(rig.backend.writes).toHaveLength(1)
  })

  it('verify passes with nothing to compare against', async () => {
    const { service } = await makeRig()
    expect(await service.verify()).toEqual({ ok: true, mismatches: [] })
  })
})

describe('snapshots', () => {
  it('can be taken in read-only mode and lists newest first', async () => {
    const rig = await makeRig()
    const first = await rig.service.snapshot('first')
    const second = await rig.service.snapshot()
    expect(first.reason).toBe('first')
    expect(second.reason).toBe('Manual snapshot')
    expect((await rig.service.listSnapshots()).map((meta) => meta.id)).toEqual([second.id, first.id])
    await expectServiceError(rig.service.snapshot('x'.repeat(201)), 'validation')
  })

  it('stores private JSON files under the device folder and leaves no temp files', async () => {
    const rig = await makeRig()
    const meta = await rig.service.snapshot('check')
    const folder = join(rig.stateDir, 'mock-gim-k64')
    expect(await readdir(folder)).toEqual([`${meta.id}.json`])
    expect((await stat(join(folder, `${meta.id}.json`))).mode & 0o777).toBe(0o600)
  })

  it('never builds a path from the snapshot id', async () => {
    const rig = await makeRig({ allowWrites: true })
    await rig.service.snapshot('real')
    for (const id of ['../mock-gim-k64/x', '..', '/etc/passwd', 'x.json', '', 'a'.repeat(200)]) {
      await expectServiceError(rig.service.restore(id, true), 'snapshot-not-found')
    }
    expect(rig.backend.writes).toHaveLength(0)
  })

  it('ignores corrupt files and refuses to restore them', async () => {
    const rig = await makeRig({ allowWrites: true })
    const meta = await rig.service.snapshot('real')
    const folder = join(rig.stateDir, 'mock-gim-k64')
    await writeFile(join(folder, `${meta.id}.json`), '{"id": "x"}')
    expect(await rig.service.listSnapshots()).toEqual([])
    await expectServiceError(rig.service.restore(meta.id, true), 'snapshot-not-found')
  })

  it('does not restore a snapshot that holds invalid values', async () => {
    const rig = await makeRig({ allowWrites: true })
    const meta = await rig.service.snapshot('real')
    const file = join(rig.stateDir, 'mock-gim-k64', `${meta.id}.json`)
    const { readFile } = await import('node:fs/promises')
    const data = JSON.parse(await readFile(file, 'utf8')) as { config: KeyboardConfig }
    data.config.layers.base.a = { kind: 'key', code: 'not-a-key' }
    await writeFile(file, JSON.stringify(data))
    await expectServiceError(rig.service.restore(meta.id, true), 'validation')
    expect(rig.backend.writes).toHaveLength(0)
  })
})
