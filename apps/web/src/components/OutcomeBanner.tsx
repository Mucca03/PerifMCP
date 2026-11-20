import { useApp } from '../state/app'
import { Button } from './ui'

/** `aria-live` region for apply and restore results. `applied` and `verified` are separate on purpose. */
export function OutcomeBanner() {
  const { outcome, setOutcome } = useApp()
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {outcome ? (
        <section
          aria-label="Last result"
          className={`border p-3 text-xs ${outcome.applied && outcome.verified ? 'border-brand' : 'border-amber-300'}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p>
              <span className="text-gray-400">{outcome.kind === 'apply' ? 'applied plan' : 'restored snapshot'}:</span>{' '}
              {outcome.label}
            </p>
            <Button onClick={() => setOutcome(undefined)} aria-label="Dismiss result">
              ×
            </Button>
          </div>
          <p className="mt-1">
            applied: <strong>{outcome.applied ? 'yes' : 'no'}</strong> · verified:{' '}
            <strong className={outcome.verified ? '' : 'text-amber-200'}>{outcome.verified ? 'yes' : 'NO'}</strong>
            {outcome.snapshotId ? <span className="text-gray-500"> · snapshot {outcome.snapshotId}</span> : null}
          </p>
          {!outcome.verified ? (
            <div className="mt-2 text-amber-200">
              <p>
                warning: the keyboard did not report the configuration that was written. Check the mismatches, then restore the
                snapshot if needed.
              </p>
              {outcome.verifyError ? <p>{outcome.verifyError}</p> : null}
              {outcome.mismatches.length > 0 ? (
                <ul aria-label="Mismatches" className="mt-1 grid gap-1">
                  {outcome.mismatches.map((m) => (
                    <li key={m.path}>
                      <span className="text-gray-500">{m.path}</span> {m.description}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {outcome.errors.length > 0 ? (
            <ul className="mt-2 text-red-300">
              {outcome.errors.map((e) => (
                <li key={e}>error: {e}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
