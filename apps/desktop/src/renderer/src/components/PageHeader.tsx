import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-left">
        <h1 className="page-header-title">{title}</h1>
        {subtitle && <span className="page-header-subtitle">{subtitle}</span>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
