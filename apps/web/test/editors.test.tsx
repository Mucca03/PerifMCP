import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MockApiClient } from '../src/api/mock-client'
import { macroFromDraft, slugify, draftFromMacro } from '../src/components/MacroEditor'
import { inputFromDraft, draftFromLighting } from '../src/components/LightingEditor'
import { renderApp } from './helpers'

describe('macro editor', () => {
  it('builds a macro with a unique id from the draft', () => {
    const draft = draftFromMacro({ id: 'x', name: 'x', steps: [{ type: 'delay', ms: 20 }, { type: 'key', code: 'a', modifiers: ['ctrl'] }] })
    draft.id = undefined
    draft.name = 'My Macro!'
    expect(slugify(draft.name)).toBe('my-macro')
    expect(macroFromDraft(draft, []).id).toBe('macro-my-macro')
    expect(macroFromDraft(draft, ['macro-my-macro']).id).toBe('macro-my-macro-2')
    expect(macroFromDraft(draft, []).steps).toEqual([
      { type: 'delay', ms: 20 },
      { type: 'key', code: 'a', modifiers: ['ctrl'] },
    ])
  })

  it('validates before a plan can be created, then creates a plan with steps in order', async () => {
    const user = userEvent.setup()
    const client = new MockApiClient({ seedAgentPlan: false })
    await renderApp({ client, route: '/macros' })
    const create = await screen.findByRole('button', { name: 'Create plan' })
    // New macro has no name yet.
    expect(create).toBeDisabled()
    expect(screen.getByRole('list', { name: 'Validation errors' })).toHaveTextContent('The macro needs a name.')
    await user.type(screen.getByRole('textbox', { name: /name/i }), 'greet')
    expect(create).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Add delay step' }))
    // The device rules (core `validateChange`) do not allow a macro to start with a delay.
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }))
    expect(create).toBeDisabled()
    expect(screen.getByRole('list', { name: 'Validation errors' })).toHaveTextContent('cannot start with a delay')
    await user.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect(create).toBeEnabled()
    await user.click(create)
    const [plan] = await client.listPlans()
    expect(plan?.changes).toEqual([
      {
        type: 'set-macro',
        macro: { id: 'macro-greet', name: 'greet', repeat: 1, steps: [{ type: 'key', code: 'a' }, { type: 'delay', ms: 50 }] },
      },
    ])
    const steps = screen.getByRole('list', { name: 'Macro steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(2)
  })

  it('rejects a bad delay in the form', async () => {
    const user = userEvent.setup()
    await renderApp({ route: '/macros' })
    await user.type(await screen.findByRole('textbox', { name: /name/i }), 'x')
    await user.click(screen.getByRole('button', { name: 'Add delay step' }))
    const delay = screen.getByRole('spinbutton', { name: /Step 2 delay/ })
    await user.clear(delay)
    await user.type(delay, '70000')
    expect(screen.getByRole('list', { name: 'Validation errors' })).toHaveTextContent('delay must be at most 60000 ms')
    expect(screen.getByRole('button', { name: 'Create plan' })).toBeDisabled()
  })
})

describe('lighting editor', () => {
  it('maps the draft to a LightingPlanInput', async () => {
    const client = new MockApiClient({ seedAgentPlan: false })
    const draft = draftFromLighting(await client.lighting())
    draft.zones = { wasd: '#ff0000' }
    draft.perKey = { escape: '#00ff00' }
    expect(inputFromDraft(draft)).toMatchObject({
      effect: 'per-key',
      brightness: 70,
      zones: { wasd: '#ff0000' },
      perKey: { escape: '#00ff00' },
    })
  })

  it('paints a key, switches to per-key and creates a lighting plan', async () => {
    const user = userEvent.setup()
    const client = new MockApiClient({ seedAgentPlan: false })
    await renderApp({ client, route: '/lighting' })
    await user.click(await screen.findByRole('combobox', { name: /effect/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: /effect/ }), 'solid')
    await user.click(screen.getByRole('button', { name: /^Space,/ }))
    await user.click(screen.getByRole('button', { name: 'Paint selected key' }))
    expect(screen.getByRole('combobox', { name: /effect/ })).toHaveValue('per-key')
    expect(screen.getByRole('list', { name: 'Painted keys' })).toHaveTextContent('space')
    await user.click(screen.getByRole('button', { name: 'Create plan' }))
    const [plan] = await client.listPlans()
    expect(plan?.changes[0]).toMatchObject({ type: 'set-lighting', lighting: { effect: 'per-key' } })
    const change = plan?.changes[0]
    expect(change?.type === 'set-lighting' && change.lighting.perKey.space).toEqual({ r: 192, g: 132, b: 252 })
  })
})

describe('snapshots page', () => {
  it('disables snapshot actions in read-only mode and shows the reason', async () => {
    await renderApp({ mode: 'read-only', route: '/snapshots' })
    expect(await screen.findByRole('button', { name: 'Create snapshot' })).toBeDisabled()
    expect(screen.getByText(/Disabled: .*read-only/i)).toBeInTheDocument()
  })

  it('restores only after a confirm step and shows the safety snapshot', async () => {
    const user = userEvent.setup()
    const client = new MockApiClient({ seedAgentPlan: false })
    await client.createSnapshot({ reason: 'before experiment' })
    await renderApp({ client, route: '/snapshots' })
    const item = (await screen.findByText('before experiment')).closest('li') as HTMLElement
    await user.click(within(item).getByRole('button', { name: 'Restore…' }))
    expect((await client.listSnapshots()).length).toBe(1)
    await user.click(within(item).getByRole('button', { name: 'Confirm and restore' }))
    const result = await screen.findByRole('region', { name: 'Last result' })
    expect(result).toHaveTextContent('restored snapshot')
    expect(result).toHaveTextContent('applied: yes')
    expect((await client.listSnapshots()).length).toBe(2)
  })
})
