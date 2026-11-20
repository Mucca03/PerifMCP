import { useState } from 'react'
import type { ConfigDiffEntry, SnapshotMeta } from '@perifmcp/core'
import { describeApiError } from '../api/client'
import { Badge, Button, Field, Panel, TextInput } from '../components/ui'
import { useApp } from '../state/app'

export function SnapshotsPage() {
  const { client, snapshots, writeEnabled, writeReasons, setOutcome, refresh } = useApp()
  const [reason, setReason] = useState('')
  const [confirmId, setConfirmId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [verifyText, setVerifyText] = useState<{ ok: boolean; mismatches: ConfigDiffEntry[] }>()

  // A snapshot only reads the configuration, so it works in read-only mode. Restore still needs writes.
  const reasonText = writeEnabled ? undefined : (writeReasons.join(' ') || 'Writes are disabled.')

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (failure) {
      setError(describeApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      await client.createSnapshot(reason.trim() ? { reason: reason.trim() } : {})
      setReason('')
      await refresh()
    })

  const restore = (snapshot: SnapshotMeta) =>
    run(async () => {
      const result = await client.restoreSnapshot(snapshot.id, { confirm: true })
      let mismatches: ConfigDiffEntry[] = []
      let verifyError: string | undefined
      if (!result.verified) {
        try {
          mismatches = (await client.verify()).mismatches
        } catch (failure) {
          verifyError = describeApiError(failure)
        }
      }
      setOutcome({
        kind: 'restore',
        label: `${snapshot.id} (${snapshot.reason})`,
        applied: result.applied,
        verified: result.verified,
        errors: result.errors,
        snapshotId: result.safetySnapshotId,
        mismatches,
        verifyError,
      })
      setConfirmId(undefined)
      await refresh()
    })

  const verify = () =>
    run(async () => {
      setVerifyText(await client.verify())
    })

  return (
    <div className="grid gap-6">
      <Panel title="create snapshot" id="create">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Field label="reason (optional)">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} className="w-72" />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            Create snapshot
          </Button>
          <Button onClick={() => void verify()} disabled={busy}>
            Verify device
          </Button>
        </form>
        {verifyText ? (
          <div role="status" className="mt-3 text-xs">
            {verifyText.ok ? (
              <p>verify: the device matches the expected configuration.</p>
            ) : (
              <div className="text-amber-200">
                <p>warning: the device differs from the expected configuration.</p>
                <ul aria-label="Mismatches" className="mt-1 grid gap-1">
                  {verifyText.mismatches.map((m) => (
                    <li key={m.path}>
                      <span className="text-gray-500">{m.path}</span> {m.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </Panel>

      <Panel title="snapshots" id="list">
        {snapshots.length === 0 ? (
          <p className="text-xs text-gray-500">No snapshots yet. One is taken automatically before every apply and restore.</p>
        ) : (
          <ul className="grid gap-3">
            {snapshots.map((s) => (
              <li key={s.id} className="border border-gray-700 p-3 text-xs" data-snapshot-id={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-white">{s.reason}</span>
                  {s.planId ? <Badge>plan {s.planId}</Badge> : null}
                  <span className="ml-auto text-gray-500">
                    {s.id} · {new Date(s.createdAt).toLocaleString()}
                  </span>
                </div>
                {confirmId === s.id ? (
                  <div role="alertdialog" aria-label="Confirm restore" className="mt-3 border border-brand p-3">
                    <p>Restore this snapshot to the keyboard? The current state is saved as a new snapshot first.</p>
                    <div className="mt-2 flex gap-2">
                      <Button variant="primary" disabled={!writeEnabled || busy} onClick={() => void restore(s)}>
                        Confirm and restore
                      </Button>
                      <Button onClick={() => setConfirmId(undefined)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <Button disabled={!writeEnabled || busy} title={reasonText} onClick={() => setConfirmId(s.id)}>
                      Restore…
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
