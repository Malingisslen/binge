import type { ComponentProps } from 'react';

// The .btn variants in globals.css as one component. `type` passes through untouched:
// a <button> inside a form still submits unless the call site says otherwise.
export type ButtonVariant = 'default' | 'acc' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'xs';

const VARIANT: Record<ButtonVariant, string> = {
  default: '',
  acc: 'btn-acc',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  'danger-ghost': 'btn-danger-ghost',
};

/** For a Link or <a> that should look like a button. */
export function buttonClass(
  { variant = 'default', size, className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  return ['btn', VARIANT[variant], size && `btn-${size}`, className].filter(Boolean).join(' ');
}

export function Button({
  variant, size, className, ...rest
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass({ variant, size, className })} {...rest} />;
}
