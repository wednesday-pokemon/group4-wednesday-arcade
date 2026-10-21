// Button per UX_SPEC §4: variants, sizes, <kbd> hint, busy verb label, and "disabled with reason"
// (aria-disabled keeps it focusable; activation does nothing but pulse/announce the visible reason).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon.tsx';
import { announce } from '../../app/announce.tsx';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  kbd?: string;
  icon?: IconName;
  /** aria-disabled with a reason shown elsewhere (pass its id via aria-describedby). */
  inactive?: boolean;
  inactiveReason?: string | null;
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', kbd, icon, inactive, inactiveReason, busy, busyLabel, children, onClick, className, ...rest },
  ref,
) {
  const blocked = Boolean(inactive || busy);
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ''}`}
      aria-disabled={blocked || undefined}
      aria-busy={busy || undefined}
      onClick={(e) => {
        if (blocked) {
          e.preventDefault();
          if (inactive && inactiveReason) {
            announce(inactiveReason);
            pulseReason(e.currentTarget.getAttribute('aria-describedby'));
          }
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      <span className="btn__label">{busy && busyLabel ? busyLabel : children}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
});

function pulseReason(ids: string | null): void {
  ids?.split(' ').forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('reason--pulse');
    void el.offsetWidth;
    el.classList.add('reason--pulse');
  });
}

export function Reason({ id, children, tone = 'info' }: { id: string; children: ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <p id={id} className={`reason reason--${tone}`}>
      <Icon name="alert" />
      <span>{children}</span>
    </p>
  );
}
