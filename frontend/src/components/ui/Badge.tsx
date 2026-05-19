import type { ReactNode } from "react";

export function Badge({ status, children }: { status?: string | null; children?: ReactNode }) {
  const value = status || "pending";
  return <span className={`badge ${value}`}>{children || value}</span>;
}
