import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'outline' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Fills its container. For the one action a panel is about. */
  block?: boolean
}

/**
 * No border *colour* here, only the width.
 *
 * Two utilities that set the same property do not resolve by the order they
 * appear in `class` — Tailwind emits them in its own order, and
 * `border-transparent` happens to come last. A shared `border-transparent`
 * here silently won over every variant's colour and took the outline off all
 * of them. Each variant states its own.
 */
const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-[6px] rounded-xs border ' +
  'font-semibold leading-tight whitespace-nowrap ' +
  'disabled:cursor-not-allowed disabled:opacity-45'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent border-accent text-bg px-[18px] py-2 ' +
    'not-disabled:hover:bg-accent-hover not-disabled:hover:border-accent-hover ' +
    'not-disabled:active:bg-accent-press not-disabled:active:border-accent-press',
  outline:
    'border-divider text-ink px-[18px] py-2 ' +
    'not-disabled:hover:bg-ink/7 not-disabled:active:bg-ink/14',
  ghost: 'border-transparent text-accent-ink not-disabled:hover:text-accent',
}

/**
 * The one button in the app.
 *
 * It exists because a button is three decisions — shape, ink, and what happens
 * when you press it — and repeating those thirty times in markup is how two of
 * them drift apart. Anything genuinely local (a fixed size, a colour borrowed
 * from a strip) is passed in through `className`, which lands last and wins.
 */
export function Button({ variant = 'outline', block, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${BASE} ${VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    />
  )
}
