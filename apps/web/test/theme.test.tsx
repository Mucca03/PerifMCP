import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SCRAMBLE_DURATION_MS, ScrambleHeading, scrambleFrame } from '../src/components/ScrambleHeading'
import { THEMES, THEME_STORAGE_KEY, ThemeProvider, nextTheme, useTheme } from '../src/lib/theme'

function Probe() {
  const { theme, cycleTheme } = useTheme()
  return (
    <button type="button" onClick={cycleTheme}>
      {theme.name}
    </button>
  )
}

describe('theme', () => {
  it('cycles with the button, applies --site-accent and persists', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.style.getPropertyValue('--site-accent')).toBe('#86efac')
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('purple')
    expect(document.documentElement.style.getPropertyValue('--site-accent')).toBe('#c084fc')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('purple')
  })

  it('cycles with T only when the focus is on body', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Probe />
        <input aria-label="field" />
      </ThemeProvider>,
    )
    await user.click(screen.getByLabelText('field'))
    await user.keyboard('t')
    expect(screen.getByRole('button')).toHaveTextContent('green')
    act(() => (document.activeElement as HTMLElement).blur())
    await user.keyboard('t')
    expect(screen.getByRole('button')).toHaveTextContent('purple')
  })

  it('restores the stored theme and wraps around the list', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'pink')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('pink')
    expect(nextTheme(THEMES[THEMES.length - 1]!)).toBe(THEMES[0])
  })
})

describe('ScrambleHeading', () => {
  it('shows the final text at once with reduced motion', () => {
    render(<ScrambleHeading trigger="/keys">keys</ScrambleHeading>)
    expect(screen.getByRole('heading', { name: 'keys' })).toHaveTextContent('keys')
  })

  it('reveals text over the duration', () => {
    const rnd = () => '#'
    expect(scrambleFrame('keys', 0, rnd)).toBe('k###')
    expect(scrambleFrame('keys', 1, rnd)).toBe('keys')
    expect(SCRAMBLE_DURATION_MS).toBe(800)
  })
})
