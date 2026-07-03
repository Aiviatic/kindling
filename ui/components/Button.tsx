import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

// Bold Spark button — variant maps to a token-driven class (no inline color).
// Focus ring (gold, 3px + offset) comes from `.btn:focus-visible` in tokens.css.
export function Button({ variant = 'primary', className, type, ...rest }: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, className].filter(Boolean).join(' ');
  // Default to type="button" so a button inside a form never submits unexpectedly.
  return <button type={type ?? 'button'} className={cls} {...rest} />;
}
