import { Fragment, useMemo } from "react";
import { estimateTokens, formatTokens, formatUSD, formatTHB } from "../../utils/tokenEstimate";
import type { AgentName } from "../../utils/tokenEstimate";

const AGENT_LABEL: Record<AgentName, string> = {
  blueprint: "Blueprint",
  generator: "Generator",
  distractor: "Distractor",
  judge: "Judge",
};

const AGENT_COLOR: Record<AgentName, string> = {
  blueprint: "#0ea5e9",
  generator: "#2563eb",
  distractor: "#7c3aed",
  judge: "#dc2626",
};

/** Pre-flight token estimator. Shows projected token usage + cost before the user runs a job. */
export function TokenEstimate({
  itemCount,
  skipBlueprint = false,
  revisions = 1,
  compact = false,
}: {
  itemCount: number;
  skipBlueprint?: boolean;
  revisions?: number;
  compact?: boolean;
}) {
  const est = useMemo(
    () => estimateTokens({ itemCount, skipBlueprint, revisions }),
    [itemCount, skipBlueprint, revisions],
  );

  if (compact) {
    return (
      <div
        title={`~${est.total_tokens.toLocaleString()} tokens across ${est.passes} pass(es) · ${formatUSD(est.cost_usd)} (${formatTHB(est.cost_usd)})`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#475569",
          background: "#f1f5f9",
          border: "1px solid #e2e8f0",
          borderRadius: 999,
          padding: "4px 10px",
          whiteSpace: "nowrap",
        }}
      >
        <strong style={{ color: "#0f172a" }}>≈ {formatTokens(est.total_tokens)}</strong>
        <span className="muted">tokens</span>
        <span className="muted">·</span>
        <strong style={{ color: "#0f172a" }}>{formatUSD(est.cost_usd)}</strong>
      </div>
    );
  }

  const maxAgent = Math.max(...Object.values(est.by_agent));

  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Pre-flight estimate</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            ≈ {est.total_tokens.toLocaleString()} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>tokens</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{formatUSD(est.cost_usd)}</div>
          <div className="muted" style={{ fontSize: 11 }}>{formatTHB(est.cost_usd)} · {est.passes} pass{est.passes === 1 ? "" : "es"}</div>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "max-content 1fr max-content", gap: "4px 8px", alignItems: "center" }}>
        {(Object.keys(est.by_agent) as AgentName[]).map((k) => {
          const v = est.by_agent[k];
          const pct = maxAgent ? (v / maxAgent) * 100 : 0;
          if (v === 0) return null;
          return (
            <Fragment key={k}>
              <span style={{ fontSize: 11, fontWeight: 600, color: AGENT_COLOR[k] }}>{AGENT_LABEL[k]}</span>
              <div style={{ background: "#e2e8f0", borderRadius: 4, height: 6, overflow: "hidden" }}>
                <div style={{ background: AGENT_COLOR[k], height: "100%", width: `${pct}%`, transition: "width .25s" }} />
              </div>
              <span className="muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{formatTokens(v)}</span>
            </Fragment>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 10, marginTop: 8, lineHeight: 1.45 }}>
        Estimate based on {est.item_count} item{est.item_count === 1 ? "" : "s"} × {est.passes} pipeline pass{est.passes === 1 ? "" : "es"} (forced 1× revision). Accuracy ≈ ±15%. Pricing reflects gemini-2.5-flash-lite defaults.
      </div>
    </div>
  );
}

/** Post-run actual token usage. Reads from the job's trace.token_usage. */
export function TokenUsage({ usage }: { usage: any }) {
  if (!usage || !usage.total_tokens) return null;

  const inputPrice = 0.10 / 1_000_000;
  const outputPrice = 0.40 / 1_000_000;
  const costUsd = (usage.input_tokens || 0) * inputPrice + (usage.output_tokens || 0) * outputPrice;

  const byAgent: Record<string, { input_tokens: number; output_tokens: number; calls: number }> = usage.by_agent || {};
  const totalPerAgent = Object.fromEntries(
    Object.entries(byAgent).map(([k, v]) => [k, (v.input_tokens || 0) + (v.output_tokens || 0)]),
  );
  const maxAgent = Math.max(0, ...Object.values(totalPerAgent));

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
        border: "1px solid #bbf7d0",
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Actual usage</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {usage.total_tokens.toLocaleString()} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>tokens</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{formatUSD(costUsd)}</div>
          <div className="muted" style={{ fontSize: 11 }}>{formatTHB(costUsd)} · {usage.calls} LLM call{usage.calls === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
        <span className="muted">Input: <strong style={{ color: "#0f172a" }}>{usage.input_tokens?.toLocaleString() ?? 0}</strong></span>
        <span className="muted">Output: <strong style={{ color: "#0f172a" }}>{usage.output_tokens?.toLocaleString() ?? 0}</strong></span>
      </div>

      {Object.keys(byAgent).length ? (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "max-content 1fr max-content max-content", gap: "4px 8px", alignItems: "center" }}>
          {(Object.entries(byAgent) as Array<[string, { input_tokens: number; output_tokens: number; calls: number }]>).map(([k, v]) => {
            const total = (v.input_tokens || 0) + (v.output_tokens || 0);
            const pct = maxAgent ? (total / maxAgent) * 100 : 0;
            const color = (AGENT_COLOR as any)[k] || "#64748b";
            const label = (AGENT_LABEL as any)[k] || k;
            return (
              <Fragment key={k}>
                <span style={{ fontSize: 11, fontWeight: 600, color }}>{label}</span>
                <div style={{ background: "#e2e8f0", borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div style={{ background: color, height: "100%", width: `${pct}%` }} />
                </div>
                <span className="muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{formatTokens(total)}</span>
                <span className="muted" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>×{v.calls}</span>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
