import type { ReactNode } from 'react';

export function PageHeader({
  crumb, title, standfirst, icon, actions,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  standfirst?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header>
      {crumb && <div className="crumb">{crumb}</div>}
      <h1 className="page-h1">
        {icon && <span className="inline-flex items-center mr-2 align-middle">{icon}</span>}
        {title}
      </h1>
      {standfirst && <p className="stand">{standfirst}</p>}
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
