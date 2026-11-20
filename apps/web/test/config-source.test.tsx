import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MockApiClient } from '../src/api/mock-client'
import { renderApp } from './helpers'

describe('configuration source notice', () => {
  it('says nothing when the configuration is read from the keyboard', async () => {
    await renderApp({ route: '/lighting' })
    expect(screen.queryByRole('note', { name: 'Configuration source' })).not.toBeInTheDocument()
  })

  it.each([
    ['last-written', /last configuration written from this app/i],
    ['assumed-default', /assumed factory defaults/i],
  ] as const)('warns on the keys and lighting pages when the source is %s', async (source, text) => {
    for (const route of ['/keys', '/lighting']) {
      const client = new MockApiClient({ seedAgentPlan: false })
      const original = client.status.bind(client)
      client.status = async () => ({ ...(await original()), configSource: source })
      const { unmount } = await renderApp({ client, route })
      expect(await screen.findByRole('note', { name: 'Configuration source' })).toHaveTextContent(text)
      expect(screen.getByText(source)).toBeInTheDocument()
      unmount()
    }
  })
})
