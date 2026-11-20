import { useApp } from '../state/app'

/** Persistent banners: read-only mode and daemon errors. */
export function StatusBanners() {
  const { status, writeEnabled, writeReasons, connectionError } = useApp()
  return (
    <div className="grid gap-2">
      {connectionError ? (
        <div role="alert" className="border border-red-400 p-3 text-xs text-red-300">
          <strong>daemon problem:</strong> {connectionError}
        </div>
      ) : null}
      {status && !writeEnabled ? (
        <div role="status" aria-label="Read-only mode" className="border border-amber-300 p-3 text-xs text-amber-200">
          <strong>{status.mode === 'read-only' ? 'read-only mode' : 'writes disabled'}:</strong> planning and previews work. Apply,
          restore and snapshot are disabled.
          {writeReasons.length > 0 ? (
            <ul className="mt-1 list-inside list-disc">
              {writeReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
