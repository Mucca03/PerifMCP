import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

const BUTTON_BASE =
  'border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-700 disabled:hover:text-white cursor-pointer'

export function Button({
  variant = 'default',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  return (
    <button
      type={type}
      className={cx(
        BUTTON_BASE,
        variant === 'primary' && 'border-brand text-brand hover:bg-brand hover:text-black disabled:hover:bg-transparent disabled:hover:text-brand',
        variant === 'default' && 'border-gray-700 text-white hover:border-brand hover:text-brand',
        variant === 'danger' && 'border-red-400 text-red-300 hover:bg-red-300 hover:text-black',
        className,
      )}
      {...props}
    />
  )
}

const FIELD = 'border border-gray-700 bg-black px-2 py-1 text-sm text-white hover:border-brand focus:border-brand'

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD, className)} {...props} />
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1 text-xs text-gray-400">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-gray-500">{hint}</span> : null}
    </label>
  )
}

export function Panel({
  title,
  children,
  actions,
  id,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  id?: string
}) {
  const headingId = id ? `${id}-heading` : undefined
  return (
    <section aria-labelledby={headingId} className="border border-gray-700 bg-black/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm text-brand">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'ok' | 'brand' }) {
  return (
    <span
      className={cx(
        'inline-block border px-1.5 py-0.5 text-xs',
        tone === 'neutral' && 'border-gray-700 text-gray-400',
        tone === 'warn' && 'border-amber-300 text-amber-200',
        tone === 'ok' && 'border-brand text-brand',
        tone === 'brand' && 'border-brand text-brand',
      )}
    >
      {children}
    </span>
  )
}
