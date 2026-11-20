import type { ConfigSource } from '@perifmcp/core'
import { useApp } from '../state/app'

const TEXT: Record<Exclude<ConfigSource, 'device'>, string> = {
  'last-written':
    'Showing the last configuration written from this app. The keyboard cannot be read back, so it may differ if it was changed another way (another tool, a factory reset).',
  'assumed-default':
    'Nothing has been written from this app yet. These values are assumed factory defaults, not read from the keyboard.',
}

/** Tells the user when the configuration on screen is not a reading of the keyboard. */
export function ConfigSourceNotice() {
  const { status } = useApp()
  const source = status?.configSource
  if (source === undefined || source === 'device') return null
  return (
    <p role="note" aria-label="Configuration source" className="border border-gray-700 p-3 text-xs text-gray-400">
      <strong className="text-gray-300">{source === 'last-written' ? 'last written' : 'assumed defaults'}:</strong> {TEXT[source]}
    </p>
  )
}
