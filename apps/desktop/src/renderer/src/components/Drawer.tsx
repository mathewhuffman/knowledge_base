import type { ReactNode } from 'react';
import { IconX } from './icons';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Use "wide" for article detail drawers (560px instead of 420px) */
  /** Use "fullscreen" for full-screen article reader experience */
  variant?: 'default' | 'wide' | 'fullscreen';
  /** Replace the default header with a custom one (fullscreen variant only) */
  customHeader?: ReactNode;
}

export function Drawer({ open, onClose, title, children, footer, variant = 'default', customHeader }: DrawerProps) {
  if (!open) return null;

  const drawerClass = `drawer${
    variant === 'wide' ? ' drawer--wide' : variant === 'fullscreen' ? ' drawer--fullscreen' : ''
  }`;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={drawerClass} role="dialog" aria-modal="true" aria-label={title}>
        {customHeader ?? (
          <div className="drawer-header">
            <h2 className="drawer-title">{title}</h2>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <IconX size={16} />
            </button>
          </div>
        )}
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>
  );
}
