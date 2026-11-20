import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export const THEMES = [
  { name: 'green', color: '#86efac' },
  { name: 'purple', color: '#c084fc' },
  { name: 'blue', color: '#93c5fd' },
  { name: 'orange', color: '#fdba74' },
  { name: 'pink', color: '#f9a8d4' },
] as const

export type Theme = (typeof THEMES)[number]

export const THEME_STORAGE_KEY = 'perifmcp-theme'

const DEFAULT_THEME: Theme = THEMES[0]

interface ThemeContextValue {
  theme: Theme
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme): void {
  document.documentElement.style.setProperty('--site-accent', theme.color)
}

function readStoredTheme(): Theme {
  try {
    const name = localStorage.getItem(THEME_STORAGE_KEY)
    return THEMES.find((t) => t.name === name) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function nextTheme(current: Theme): Theme {
  const index = THEMES.findIndex((t) => t.name === current.name)
  return THEMES[(index + 1) % THEMES.length] ?? DEFAULT_THEME
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next.name)
      } catch {
        // Storage can be unavailable (private mode). The theme still changes for this session.
      }
      return next
    })
  }, [])

  // `T` cycles the theme, but only when nothing is focused (target is body). This keeps typing in inputs safe.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyT' && event.target === document.body && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        cycleTheme()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cycleTheme])

  const value = useMemo(() => ({ theme, cycleTheme }), [theme, cycleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
