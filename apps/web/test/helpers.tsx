import { render, screen } from '@testing-library/react'
import { App } from '../src/App'
import { MockApiClient, type MockOptions } from '../src/api/mock-client'

/** Renders the whole app on a mock client. Polling is slow so tests control refreshes. */
export async function renderApp(options: MockOptions & { route?: string; client?: MockApiClient } = {}) {
  const { route, client: given, ...mockOptions } = options
  window.location.hash = route ?? '/keys'
  const client = given ?? new MockApiClient(mockOptions)
  const view = render(<App client={client} mockReason="test" pollIntervalMs={60_000} />)
  // The header shows the connection state once the first load finished.
  await screen.findByText(/^(connected|disconnected|unknown-model|daemon error)$/)
  return { client, ...view }
}
