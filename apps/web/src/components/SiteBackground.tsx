/** Fixed dot grid in the accent color plus a blurred glow at the top. Decorative only. */
export function SiteBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.15] transition-colors duration-700"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--site-accent) 70%, transparent) 1px, transparent 0)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(ellipse at top, black 20%, transparent 75%)',
        }}
      />
      <div
        className="absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-20 blur-3xl transition-colors duration-700"
        style={{ background: 'radial-gradient(closest-side, var(--site-accent), transparent)' }}
      />
    </div>
  )
}
