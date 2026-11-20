import { useEffect, useState } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export const SCRAMBLE_DURATION_MS = 800

function randomChar(): string {
  return CHARS.charAt(Math.floor(Math.random() * CHARS.length))
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Reveals `text` left to right over ~800 ms. With reduced motion the final text shows at once. */
export function scrambleFrame(text: string, progress: number, random: () => string = randomChar): string {
  const revealed = progress * text.length
  return text
    .split('')
    .map((ch, i) => (ch === ' ' ? ' ' : i <= revealed ? ch : random()))
    .join('')
}

export function ScrambleHeading({ children, trigger }: { children: string; trigger: string }) {
  const [display, setDisplay] = useState(children)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(children)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / SCRAMBLE_DURATION_MS, 1)
      setDisplay(scrambleFrame(children, progress))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [children, trigger])

  return (
    <h1 className="overflow-hidden text-2xl font-bold text-brand" aria-label={children}>
      <span aria-hidden="true">{display}</span>
    </h1>
  )
}
