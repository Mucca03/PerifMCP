import { useId, useState } from 'react'
import type { ConfigPlan } from '@perifmcp/core'
import { describeApiError, errorCode } from '../api/client'
import { useApp } from '../state/app'
import { Badge, Button } from './ui'

/**
 * One pending plan. Flow: review (loads the diff) -> apply... -> explicit confirm -> result.
 * Nothing is written before the confirm button, and the apply button is disabled in read-only mode.
 */
export function PlanCard({ plan }: { plan: ConfigPlan }) {
  const {
    client,
    status,
    writeEnabled,
    writeReasons,
    focusPlanId,
    focusPreview,
    focusPreviewError,
    setFocusPlanId,
    ownPlanIds,
    dismissPlan,
    setOutcome,
    refresh,
  } = useApp()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const reasonId = useId()

  const expanded = focusPlanId === plan.id
  const preview = expanded && focusPreview?.plan.id === plan.id ? focusPreview : undefined
  const stale = status !== undefined && status.configRevision !== plan.baseRevision
  const origin = ownPlanIds.has(plan.id) ? 'this UI' : 'agent or other client'
  const canApply = writeEnabled && !stale && preview !== undefined && !busy
  const disabledReason = !writeEnabled
    ? writeReasons.join(' ') || 'Writes are disabled.'
    : stale
      ? 'The configuration changed after this plan was created.'
      : preview === undefined
        ? 'Review the diff first.'
        : ''

  const toggle = () => {
    setConfirming(false)
    setError(undefined)
    setFocusPlanId(expanded ? undefined : plan.id)
  }

  const apply = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await client.applyPlan(plan.id, { confirm: true })
      let mismatches: Awaited<ReturnType<typeof client.verify>>['mismatches'] = []
      let verifyError: string | undefined
      if (!result.verified) {
        try {
          mismatches = (await client.verify()).mismatches
        } catch (verifyFailure) {
          verifyError = describeApiError(verifyFailure)
        }
      }
      setOutcome({
        kind: 'apply',
        label: plan.summary,
        applied: result.applied,
        verified: result.verified,
        errors: result.errors,
        snapshotId: result.snapshotId,
        mismatches,
        verifyError,
      })
      setConfirming(false)
      setFocusPlanId(undefined)
      await refresh()
    } catch (failure) {
      setError(describeApiError(failure))
      setConfirming(false)
      const code = errorCode(failure)
      if (code === 'plan-stale' || code === 'plan-not-found') await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="border border-gray-700 p-3" aria-label={`Plan ${plan.summary}`} data-plan-id={plan.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm text-white">{plan.summary}</h3>
        <Badge>{origin}</Badge>
        {stale ? <Badge tone="warn">stale</Badge> : null}
        <span className="ml-auto text-xs text-gray-500">{new Date(plan.createdAt).toLocaleTimeString()}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {plan.id} · {plan.changes.length} change{plan.changes.length === 1 ? '' : 's'}
      </p>
      {plan.warnings.length > 0 ? (
        <ul className="mt-2 text-xs text-amber-200">
          {plan.warnings.map((w) => (
            <li key={w}>warning: {w}</li>
          ))}
        </ul>
      ) : null}
      {stale ? (
        <p className="mt-2 text-xs text-amber-200">
          stale: the keyboard configuration changed after this plan was created. It cannot be applied. Dismiss it and create a new
          plan.
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-3 border-t border-gray-700 pt-3">
          {focusPreviewError ? (
            <p role="alert" className="text-xs text-red-300">
              {focusPreviewError}
            </p>
          ) : preview ? (
            preview.diff.length === 0 ? (
              <p className="text-xs text-gray-400">No differences from the current configuration.</p>
            ) : (
              <ul aria-label="Diff" className="grid gap-1 text-xs">
                {preview.diff.map((entry) => (
                  <li key={entry.path} className="text-gray-300">
                    <span className="text-gray-500">{entry.path}</span> {entry.description}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-xs text-gray-500">Loading diff…</p>
          )}
        </div>
      ) : null}

      {confirming ? (
        <div role="alertdialog" aria-label="Confirm apply" className="mt-3 border border-brand p-3 text-xs">
          <p>
            Write {plan.changes.length} change{plan.changes.length === 1 ? '' : 's'} to the keyboard? A snapshot is taken first, and
            the result is read back and verified.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => void apply()} disabled={!canApply}>
              Confirm and apply
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={toggle} aria-expanded={expanded}>
          {expanded ? 'Hide diff' : 'Review diff'}
        </Button>
        <Button
          variant="primary"
          disabled={!canApply || confirming}
          aria-describedby={disabledReason ? reasonId : undefined}
          title={disabledReason || undefined}
          onClick={() => setConfirming(true)}
        >
          Apply…
        </Button>
        <Button onClick={() => dismissPlan(plan.id)} aria-label={`Dismiss plan ${plan.summary} from this view`}>
          Dismiss
        </Button>
      </div>
      {disabledReason ? (
        <p id={reasonId} className="mt-2 text-xs text-gray-500">
          Apply disabled: {disabledReason}
        </p>
      ) : null}
    </article>
  )
}
