import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MockApiClient } from '../src/api/mock-client'
import { renderApp } from './helpers'

describe('plan, preview and confirm flow', () => {
  it('disables apply and explains why when writes are disabled, but still allows review', async () => {
    const user = userEvent.setup()
    await renderApp({ mode: 'read-only', route: '/plans' })
    expect(screen.getByRole('status', { name: /read-only mode/i })).toBeInTheDocument()
    const card = await screen.findByRole('article', { name: /Agent: map Caps Lock/ })
    await user.click(within(card).getByRole('button', { name: 'Review diff' }))
    expect(await within(card).findByText(/capslock: key capslock -> key escape/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Apply/ })).toBeDisabled()
    expect(within(card).getByText(/Apply disabled: .*read-only/i)).toBeInTheDocument()
  })

  it('requires an explicit confirm step before anything is written', async () => {
    const user = userEvent.setup()
    const client = new MockApiClient()
    const applySpy = vi.spyOn(client, 'applyPlan')
    await renderApp({ client, route: '/plans' })
    const card = await screen.findByRole('article', { name: /Agent: map Caps Lock/ })
    const apply = within(card).getByRole('button', { name: /Apply/ })
    expect(apply).toBeDisabled() // diff not reviewed yet
    await user.click(within(card).getByRole('button', { name: 'Review diff' }))
    await within(card).findByText(/capslock:/)
    await user.click(within(card).getByRole('button', { name: /Apply/ }))
    expect(applySpy).not.toHaveBeenCalled()
    const dialog = within(card).getByRole('alertdialog', { name: /confirm apply/i })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(applySpy).not.toHaveBeenCalled()
    await user.click(within(card).getByRole('button', { name: /Apply/ }))
    await user.click(within(card).getByRole('button', { name: 'Confirm and apply' }))
    expect(applySpy).toHaveBeenCalledWith('plan-1', { confirm: true })
    const result = await screen.findByRole('region', { name: 'Last result' })
    expect(result).toHaveTextContent('applied: yes')
    expect(result).toHaveTextContent('verified: yes')
    await waitFor(() => expect(screen.queryByRole('article', { name: /Agent: map Caps Lock/ })).not.toBeInTheDocument())
  })

  it('surfaces plan-stale from the API instead of failing silently', async () => {
    const user = userEvent.setup()
    const client = new MockApiClient()
    await renderApp({ client, route: '/plans' })
    const card = await screen.findByRole('article', { name: /Agent: map Caps Lock/ })
    await user.click(within(card).getByRole('button', { name: 'Review diff' }))
    await within(card).findByText(/capslock:/)
    // The configuration changes behind the UI's back (another client applies a plan).
    const other = await client.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    await client.applyPlan(other.id, { confirm: true })
    // Without a refresh the UI still believes the plan is fresh, so apply reaches the API and gets plan-stale.
    await user.click(within(card).getByRole('button', { name: /Apply/ }))
    await user.click(within(card).getByRole('button', { name: 'Confirm and apply' }))
    const alert = await within(card).findByRole('alert')
    expect(alert).toHaveTextContent('[plan-stale]')
  })

  it('shows a stale label once polling sees the new revision', async () => {
    const client = new MockApiClient()
    await renderApp({ client, route: '/plans' })
    await screen.findByRole('article', { name: /Agent: map Caps Lock/ })
    const other = await client.planKeys({ layer: 'base', assignments: { a: { kind: 'none' } } })
    await client.applyPlan(other.id, { confirm: true })
    // Trigger a poll through the visibility handler.
    document.dispatchEvent(new Event('visibilitychange'))
    const card = await screen.findByRole('article', { name: /Agent: map Caps Lock/ })
    await within(card).findByText('stale')
    expect(within(card).getByRole('button', { name: /Apply/ })).toBeDisabled()
  })

  it('shows a warning with mismatches when verification fails', async () => {
    const user = userEvent.setup()
    const client = new MockApiClient()
    client.queueVerifyFailure()
    await renderApp({ client, route: '/plans' })
    const card = await screen.findByRole('article', { name: /Agent: map Caps Lock/ })
    await user.click(within(card).getByRole('button', { name: 'Review diff' }))
    await within(card).findByText(/capslock:/)
    await user.click(within(card).getByRole('button', { name: /Apply/ }))
    await user.click(within(card).getByRole('button', { name: 'Confirm and apply' }))
    const result = await screen.findByRole('region', { name: 'Last result' })
    expect(result).toHaveTextContent('applied: yes')
    expect(result).toHaveTextContent('verified: NO')
    expect(await within(result).findByRole('list', { name: 'Mismatches' })).toBeInTheDocument()
  })
})
