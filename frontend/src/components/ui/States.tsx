export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <div className="card card-body muted">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="card card-body muted">{label}</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return <div className="card card-body" style={{ color: "var(--danger)" }}>Failed: {message}</div>;
}
