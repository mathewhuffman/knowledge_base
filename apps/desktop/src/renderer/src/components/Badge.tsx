type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

import type { ReactNode } from 'react';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
