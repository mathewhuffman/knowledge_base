import type { ReactNode } from 'react';
import { IconAlertCircle } from './icons';

interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
}: ErrorStateProps) {
  return (
    <div className="error-state">
      <div className="error-state-icon">
        <IconAlertCircle size={48} />
      </div>
      <h3 className="error-state-title">{title}</h3>
      {description && <p className="error-state-desc">{description}</p>}
      {action}
    </div>
  );
}
