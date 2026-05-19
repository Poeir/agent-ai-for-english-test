import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="card-header">
      <div>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {description ? <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{description}</div> : null}
      </div>
      {actions}
    </header>
  );
}
