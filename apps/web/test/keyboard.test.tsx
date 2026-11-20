import { DEFAULT_LAYOUT, createDefaultConfig } from '@perifmcp/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyboardView, neighbor } from '../src/components/KeyboardView'
import { MAX_CAP_ALPHA, blendOnBlack, contrastRatio } from '../src/lib/color'
import { renderApp } from './helpers'

describe('KeyboardView', () => {
  it('renders 64 keys from the layout', () => {
    render(
      <KeyboardView layout={DEFAULT_LAYOUT} config={createDefaultConfig()} layer="base" selectedKey={undefined} onSelect={() => undefined} />,
    )
    const group = screen.getByRole('group', { name: /keyboard, base layer/i })
    expect(within(group).getAllByRole('button')).toHaveLength(64)
  })

  it('selects on click and on focus, and moves with arrow keys', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <KeyboardView layout={DEFAULT_LAYOUT} config={createDefaultConfig()} layer="base" selectedKey="q" onSelect={onSelect} />,
    )
    await user.click(screen.getByRole('button', { name: /^W,/ }))
    expect(onSelect).toHaveBeenLastCalledWith('w')
    screen.getByRole('button', { name: /^Q,/ }).focus()
    await user.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenLastCalledWith('w')
    expect(neighbor(DEFAULT_LAYOUT, 'space', 'ArrowUp')).toBeDefined()
    expect(neighbor(DEFAULT_LAYOUT, 'escape', 'ArrowLeft')).toBeUndefined()
  })

  it('marks keys changed by a pending plan with text, not only color', () => {
    render(
      <KeyboardView
        layout={DEFAULT_LAYOUT}
        config={createDefaultConfig()}
        layer="base"
        selectedKey={undefined}
        onSelect={() => undefined}
        changedKeys={new Set(['capslock'])}
      />,
    )
    expect(screen.getByRole('button', { name: /^Caps,.*changed by pending plan/ })).toBeInTheDocument()
  })

  it('keeps white labels readable on the brightest lighting fill', () => {
    const white = { r: 255, g: 255, b: 255 }
    for (const r of [0, 255]) {
      for (const g of [0, 255]) {
        for (const b of [0, 255]) {
          expect(contrastRatio(white, blendOnBlack({ r, g, b }, MAX_CAP_ALPHA))).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})

describe('keys page', () => {
  it('shows the keyboard, layers and the inspector for a selected key', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(await screen.findByRole('group', { name: /keyboard, base layer/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'fn1' }))
    expect(screen.getByRole('group', { name: /keyboard, fn1 layer/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Caps,/ }))
    expect(screen.getByRole('heading', { name: /key inspector: Caps/ })).toBeInTheDocument()
  })
})
