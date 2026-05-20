import { useEffect, useMemo, useRef, useState } from "react";
import type { JobResponse } from "../../types/api";
import { TokenUsage } from "./TokenEstimate";

type ViewMode = "pretty" | "json";

type NodeKey = "blueprint" | "generator" | "distractor" | "judge";
type NodeStatus = "waiting" | "running" | "done" | "failed";

const NODES: Array<{ key: NodeKey; title: string; subtitle: string }> = [
  { key: "blueprint",  title: "Blueprint",  subtitle: "Parse the free-text requirement into a structured blueprint." },
  { key: "generator",  title: "Generator",  subtitle: "Produce the passage (if any) and full question items with options. On a revision pass, inlines Judge feedback to refine output." },
  { key: "distractor", title: "Distractor", subtitle: "Refine A/B/C/D options for MCQ-shape items; pass-through others." },
  { key: "judge",      title: "Judge",      subtitle: "Score each question; always feeds suggestions back for one mandatory revision pass (configured via MAX_REVISION_LOOPS)." },
];

function nodeStatus(node: NodeKey, job: JobResponse | undefined, trace: any): NodeStatus {
  if (!job) return "waiting";
  if (job.status === "failed" && !trace?.[node]) return "failed";
  const current = job.current_node || "";
  const isCurrent = current.toLowerCase().includes(node);
  const hasOutput = (() => {
    switch (node) {
      case "blueprint":  return Boolean(trace?.blueprint);
      case "generator":  return Boolean(trace?.raw_questions?.length) || Boolean(trace?.passage);
      case "distractor": return Boolean(trace?.questions_with_options?.length);
      case "judge":      return Boolean(trace?.judge_results?.length);
    }
  })();
  if (hasOutput) return isCurrent && job.status === "running" ? "running" : "done";
  if (isCurrent && job.status === "running") return "running";
  return "waiting";
}

function StatusIcon({ status }: { status: NodeStatus }) {
  if (status === "running") return <span className="flow-spinner" aria-label="running" />;
  if (status === "done")    return <span className="flow-icon-check" aria-label="done">✓</span>;
  if (status === "failed")  return <span className="flow-icon-cross" aria-label="failed">✕</span>;
  return <span className="flow-icon-dot" aria-label="waiting" />;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  waiting: "Waiting",
  running: "Running…",
  done:    "Done",
  failed:  "Failed",
};

function summaryFor(node: NodeKey, trace: any): string | null {
  switch (node) {
    case "blueprint": {
      const bp = trace?.blueprint;
      if (!bp) return null;
      const bits: string[] = [];
      if (bp.skill) bits.push(bp.skill);
      if (bp.cefr) bits.push(bp.cefr);
      if (bp.item_count) bits.push(`${bp.item_count} items`);
      return bits.join(" · ") || null;
    }
    case "generator": {
      const qs = trace?.raw_questions || [];
      const pasLen = (trace?.passage || "").length;
      if (!qs.length && !pasLen) return null;
      return `${qs.length} question${qs.length === 1 ? "" : "s"}${pasLen ? ` · passage ${pasLen}c` : ""}`;
    }
    case "distractor": {
      const qs = trace?.questions_with_options || [];
      return qs.length ? `${qs.length} finalized` : null;
    }
    case "judge": {
      const rs = trace?.judge_results || [];
      if (!rs.length) return null;
      const passed = rs.filter((r: any) => r.pass === true).length;
      return `${passed}/${rs.length} passed${trace?.revision_count ? ` · ${trace.revision_count} revision(s)` : ""}`;
    }
  }
}

// ============================================================
// Pretty renderers
// ============================================================

const MCQ_SHAPE = new Set([
  "multiple_choice","main_idea","detail","inference","vocabulary_in_context","tone_purpose",
  "fill_blank","cloze","true_false_not_given","reordering","error_identification",
]);

function extrasOf(q: any): Record<string, any> | null {
  if (q?.extras) return q.extras;
  if (q?.options && q.options._extras) return q.options._extras;
  return null;
}

function LetterOptions({ options, correct }: { options: Record<string, any>; correct?: string | null }) {
  const letters = ["A", "B", "C", "D"];
  const present = letters.filter((L) => options?.[L] != null && String(options[L]).trim() !== "");
  if (!present.length) {
    return (
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Correct answer: <strong style={{ color: "var(--success)" }}>{correct ?? "—"}</strong>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      {present.map((L) => (
        <div key={L} className={`option-row ${L === correct ? "correct" : ""}`}>
          <strong style={{ marginRight: 6 }}>{L}.</strong>
          <span>{String(options[L])}</span>
          {L === correct ? <span style={{ float: "right", color: "var(--success)", fontWeight: 700, fontSize: 12 }}>✓ correct</span> : null}
        </div>
      ))}
    </div>
  );
}

function MatchingBody({ q }: { q: any }) {
  const opts = q.options || {};
  const left: string[] = Array.isArray(opts.left) ? opts.left : [];
  const right: string[] = Array.isArray(opts.right) ? opts.right : [];
  return (
    <>
      <div className="grid-2" style={{ marginTop: 6 }}>
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Column A</div>
          <ol style={{ margin: "4px 0", paddingLeft: 18, fontSize: 13 }}>
            {left.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Column B</div>
          <ol style={{ margin: "4px 0", paddingLeft: 18, fontSize: 13, listStyleType: "upper-alpha" }}>
            {right.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        Correct pairing: <strong style={{ color: "var(--success)" }}>{q.correct_answer ?? "—"}</strong>
      </div>
    </>
  );
}

function FreeTextBody({ q, label, collapsible = false }: { q: any; label: string; collapsible?: boolean }) {
  const ex = extrasOf(q) || {};
  const meta: string[] = [];
  if (ex.min_words || ex.max_words) meta.push(`Length: ${ex.min_words ?? "?"}–${ex.max_words ?? "?"} words`);
  if (ex.max_words && !ex.min_words) meta.push(`≤ ${ex.max_words} words`);
  if (ex.prep_seconds || ex.response_seconds) meta.push(`Prep ${ex.prep_seconds ?? "?"}s · Response ${ex.response_seconds ?? "?"}s`);
  if (Array.isArray(ex.rubric) && ex.rubric.length) meta.push(`Rubric: ${ex.rubric.join(", ")}`);
  const body = (
    <div style={{ marginTop: 4, padding: "8px 10px", background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
      {q.correct_answer ?? "—"}
    </div>
  );
  return (
    <>
      {meta.length ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{meta.join(" · ")}</div> : null}
      {collapsible ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--primary)" }}>{label}</summary>
          {body}
        </details>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{label}</div>
          {body}
        </>
      )}
    </>
  );
}

function QuestionBody({ q }: { q: any }) {
  const t = q.question_type || "";
  if (t === "short_answer") return <FreeTextBody q={q} label="Expected answer" />;
  if (t === "essay") return <FreeTextBody q={q} label="Show model answer" collapsible />;
  if (t === "speaking_prompt") return <FreeTextBody q={q} label="Show model response" collapsible />;
  if (t === "matching") return <MatchingBody q={q} />;
  if (t === "error_identification") {
    const ex = extrasOf(q) || {};
    return (
      <>
        <LetterOptions options={q.options || {}} correct={q.correct_answer} />
        {ex.correction ? (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Corrected: <strong style={{ color: "var(--text)" }}>{ex.correction}</strong>
          </div>
        ) : null}
      </>
    );
  }
  return <LetterOptions options={q.options || {}} correct={q.correct_answer} />;
}

function QuestionCard({ q, index }: { q: any; index: number }) {
  return (
    <div className="question-card" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, fontWeight: 600, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
          Q{index + 1}. {q.stem || ""}
        </div>
        {q.question_type ? (
          <span className="badge" style={{ fontSize: 10, borderColor: "#cbd5e1", background: "#f1f5f9", color: "#475569" }}>
            {q.question_type}
          </span>
        ) : null}
      </div>
      <QuestionBody q={q} />
      {q.explanation ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          <strong>Why:</strong> {q.explanation}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// Per-node panels
// ============================================================

function KV({ rows }: { rows: Array<[string, any]> }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "4px 12px", fontSize: 13, margin: 0 }}>
      {rows.map(([k, v]) => (
        <FragmentRow key={k} k={k} v={v} />
      ))}
    </dl>
  );
}
function FragmentRow({ k, v }: { k: string; v: any }) {
  const display = v == null || v === "" ? "—"
    : Array.isArray(v) ? v.join(", ")
    : typeof v === "object" ? JSON.stringify(v)
    : String(v);
  return (
    <>
      <dt style={{ color: "#64748b", fontWeight: 600 }}>{k}</dt>
      <dd style={{ margin: 0, color: "#0f172a" }}>{display}</dd>
    </>
  );
}

function BlueprintPretty({ blueprint }: { blueprint: any }) {
  if (!blueprint) return <Empty />;
  const keys = ["skill", "cefr", "topic", "passage_length", "difficulty", "item_count", "question_types"];
  const rows = keys.filter((k) => blueprint[k] !== undefined).map((k) => [k, blueprint[k]] as [string, any]);
  return <KV rows={rows} />;
}

function GeneratorPretty({ passage, questions }: { passage?: string | null; questions?: any[] | null }) {
  if (!passage && !(questions && questions.length)) return <Empty />;
  return (
    <div>
      {passage ? (
        <div style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Passage</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{passage}</div>
        </div>
      ) : null}
      {questions && questions.length ? (
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Questions ({questions.length})</div>
          {questions.map((q, i) => <QuestionCard key={i} q={q} index={i} />)}
        </div>
      ) : null}
    </div>
  );
}

function scoreColor(v?: number | null) {
  if (v == null) return "#9ca3af";
  if (v >= 8) return "#16a34a";
  if (v >= 6) return "#ca8a04";
  return "#dc2626";
}

function ScoreBar({ label, value, max = 10 }: { label: string; value?: number | null; max?: number }) {
  const v = value == null ? 0 : Math.max(0, Math.min(max, Number(value)));
  const pct = (v / max) * 100;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span className="muted">{label}</span>
        <span style={{ fontWeight: 600 }}>
          {value ?? "—"}<span className="muted"> / {max}</span>
        </span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 4, height: 6, marginTop: 2 }}>
        <div style={{ background: scoreColor(value), height: "100%", borderRadius: 4, width: `${pct}%`, transition: "width .25s" }} />
      </div>
    </div>
  );
}

function JudgePretty({ trace }: { trace: any }) {
  const results: any[] = trace?.judge_results || [];
  if (!results.length) return <Empty />;
  const passCount = results.filter((r) => r.pass === true).length;
  const total = results.length;
  const avg = total ? (results.reduce((s, r) => s + (r.overall_score || 0), 0) / total).toFixed(2) : "—";
  const ambigColor = (a?: string) => a === "low" ? "completed" : a === "medium" ? "partial" : a === "high" ? "failed" : "pending";

  return (
    <div>
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, fontSize: 13, marginBottom: 8 }}>
        <strong>Verdict:</strong>{" "}
        {trace?.judge_passed === true ? <span className="badge completed">PASS</span> : trace?.judge_passed === false ? <span className="badge failed">FAIL</span> : null}
        <span className="muted"> · {passCount}/{total} passed</span>
        <span className="muted"> · avg <span style={{ color: scoreColor(parseFloat(avg)), fontWeight: 700 }}>{avg}</span></span>
        <span className="muted"> · revisions {trace?.revision_count ?? 0}</span>
        {trace?.revision_count > 0 ? (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            ↻ Scores shown are from the <strong>post-revision</strong> judge pass — issues/suggestions below were fed back to the Generator before re-scoring.
          </div>
        ) : null}
      </div>
      {results.map((r, i) => (
        <div key={i} className="question-card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontWeight: 650 }}>Q{(r.question_index ?? i) + 1}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {r.ambiguity_risk ? <span className={`badge ${ambigColor(r.ambiguity_risk)}`}>ambig: {r.ambiguity_risk}</span> : null}
              <span className="badge" style={{ color: scoreColor(r.overall_score), borderColor: "currentColor" }}>overall {r.overall_score ?? "—"}</span>
              <span className={`badge ${r.pass ? "completed" : "failed"}`}>{r.pass ? "pass" : "fail"}</span>
            </div>
          </div>
          <ScoreBar label="CEFR alignment" value={r.cefr_alignment} />
          <ScoreBar label="Distractor quality" value={r.distractor_quality} />
          <ScoreBar label="Grammar naturalness" value={r.grammar_naturalness} />
          {Array.isArray(r.issues) && r.issues.length ? (
            <div style={{ marginTop: 6 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Issues</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                {r.issues.map((it: string, k: number) => (
                  <span key={k} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b" }}>{it}</span>
                ))}
              </div>
            </div>
          ) : null}
          {Array.isArray(r.revision_suggestions) && r.revision_suggestions.length ? (
            <div style={{ marginTop: 6 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Suggestions</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                {r.revision_suggestions.map((it: string, k: number) => (
                  <span key={k} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#dbeafe", border: "1px solid #bfdbfe", color: "#1e40af" }}>{it}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <div className="muted" style={{ fontSize: 13 }}>No data yet</div>;
}

function JsonBlock({ value }: { value: any }) {
  return <pre className="json" style={{ margin: 0, maxHeight: 360, overflow: "auto" }}>{value == null ? "—" : JSON.stringify(value, null, 2)}</pre>;
}

// ============================================================
// Main view
// ============================================================

export function PipelineView({ job, requirement }: { job: JobResponse | undefined; requirement: string }) {
  const [mode, setMode] = useState<ViewMode>("pretty");
  const [expanded, setExpanded] = useState<Set<NodeKey>>(new Set(["blueprint","generator","distractor","judge"]));
  const trace: any = useMemo(() => (job?.result as any)?.trace || {}, [job]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  type Pt = { x: number; y: number };
  type ForwardWireGeo = { key: string; fromKey: NodeKey; toKey: NodeKey; from: Pt; to: Pt; d: string };
  type ArcGeo = { d: string; from: Pt; to: Pt; labelX: number; labelY: number };
  const [geo, setGeo] = useState<{
    w: number;
    h: number;
    wires: ForwardWireGeo[];
    arc: ArcGeo;
  } | null>(null);
  const ARC_H = 52;

  useEffect(() => {
    const compute = () => {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const rects: Partial<Record<NodeKey, { left: number; right: number; top: number; bottom: number; cx: number; cy: number }>> = {};
      for (const n of NODES) {
        const el = wrap.querySelector<HTMLElement>(`[data-node="${n.key}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        rects[n.key] = {
          left: r.left - wr.left,
          right: r.right - wr.left,
          top: r.top - wr.top,
          bottom: r.bottom - wr.top,
          cx: r.left + r.width / 2 - wr.left,
          cy: r.top + r.height / 2 - wr.top,
        };
      }
      const ns = rects as Record<NodeKey, NonNullable<typeof rects[NodeKey]>>;

      const wires: ForwardWireGeo[] = [];
      for (let i = 0; i < NODES.length - 1; i++) {
        const aK = NODES[i].key, bK = NODES[i + 1].key;
        const a = ns[aK], b = ns[bK];
        const y = (a.cy + b.cy) / 2;
        const from = { x: a.right, y };
        const to = { x: b.left, y };
        wires.push({
          key: `${aK}->${bK}`,
          fromKey: aK,
          toKey: bK,
          from, to,
          d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
        });
      }

      // Reverse arc: elliptical half-arc from Judge top → Generator top
      const judge = ns.judge, gen = ns.generator;
      const arcFrom = { x: judge.cx, y: judge.top };
      const arcTo   = { x: gen.cx,   y: gen.top };
      const rx = Math.abs(arcFrom.x - arcTo.x) / 2;
      const ry = ARC_H;
      // Elliptical arc: large=0, sweep=0 → counterclockwise upward bulge from right→left
      const arcD = `M ${arcFrom.x} ${arcFrom.y} A ${rx} ${ry} 0 0 0 ${arcTo.x} ${arcTo.y}`;

      setGeo({
        w: wr.width,
        h: wr.height,
        wires,
        arc: {
          d: arcD,
          from: arcFrom,
          to: arcTo,
          labelX: (arcFrom.x + arcTo.x) / 2,
          labelY: Math.min(arcFrom.y, arcTo.y) - ARC_H + 6,
        },
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [job]);

  const statuses: Record<NodeKey, NodeStatus> = {
    blueprint:  nodeStatus("blueprint", job, trace),
    generator:  nodeStatus("generator", job, trace),
    distractor: nodeStatus("distractor", job, trace),
    judge:      nodeStatus("judge", job, trace),
  };

  function toggle(k: NodeKey) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const inputs: Record<NodeKey, any> = {
    blueprint:  { raw_requirement: requirement || job?.request?.requirement || "" },
    generator:  { blueprint: trace.blueprint || null },
    distractor: { passage: trace.passage || null, raw_questions: trace.raw_questions || null },
    judge:      { questions_with_options: trace.questions_with_options || null },
  };
  const outputs: Record<NodeKey, any> = {
    blueprint:  { blueprint: trace.blueprint || null },
    generator:  { passage: trace.passage || null, raw_questions: trace.raw_questions || null },
    distractor: { questions_with_options: trace.questions_with_options || null },
    judge:      { judge_results: trace.judge_results || null, judge_passed: trace.judge_passed, revision_count: trace.revision_count },
  };

  function renderPrettyInput(k: NodeKey) {
    if (k === "blueprint") {
      const text = inputs.blueprint.raw_requirement;
      return text ? <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>{text}</div> : <Empty />;
    }
    if (k === "generator") return <BlueprintPretty blueprint={inputs.generator.blueprint} />;
    if (k === "distractor") {
      const qs = inputs.distractor.raw_questions || [];
      return qs.length
        ? <div className="muted" style={{ fontSize: 13 }}>{qs.length} question(s) generated, with passage of {String(inputs.distractor.passage || "").length} chars.</div>
        : <Empty />;
    }
    const qs = inputs.judge.questions_with_options || [];
    return qs.length
      ? <div className="muted" style={{ fontSize: 13 }}>{qs.length} question(s) ready for judging.</div>
      : <Empty />;
  }

  function renderPrettyOutput(k: NodeKey) {
    if (k === "blueprint") return <BlueprintPretty blueprint={outputs.blueprint.blueprint} />;
    if (k === "generator") return <GeneratorPretty passage={outputs.generator.passage} questions={outputs.generator.raw_questions} />;
    if (k === "distractor") {
      const qs: any[] = outputs.distractor.questions_with_options || [];
      return qs.length ? <div>{qs.map((q, i) => <QuestionCard key={i} q={q} index={i} />)}</div> : <Empty />;
    }
    return <JudgePretty trace={trace} />;
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* === Flow diagram with wired connections === */}
      {(() => {
        const STATE_COLOR = { idle: "#cbd5e1", transmitting: "#2563eb", completed: "#16a34a" } as const;
        type WireState = keyof typeof STATE_COLOR;

        const wireState = (toKey: NodeKey): WireState => {
          const s = statuses[toKey];
          if (s === "running") return "transmitting";
          if (s === "done") return "completed";
          return "idle";
        };

        const revisionCount: number = trace?.revision_count ?? 0;
        const arcState: WireState =
          revisionCount === 0 ? "idle"
          : job?.status === "running" ? "transmitting"
          : "completed";
        const arcColor = STATE_COLOR[arcState];

        return (
          <div ref={wrapperRef} style={{ position: "relative", paddingTop: ARC_H + 14 }}>
            {geo ? (
              <svg
                width={geo.w}
                height={geo.h}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  overflow: "visible",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              >
                {/* Forward wires */}
                {geo.wires.map((w) => {
                  const state = wireState(w.toKey);
                  const color = STATE_COLOR[state];
                  return (
                    <g key={w.key}>
                      <path
                        d={w.d}
                        stroke={color}
                        strokeWidth={2.25}
                        fill="none"
                        strokeLinecap="round"
                      />
                      <circle cx={w.from.x} cy={w.from.y} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
                      <circle cx={w.to.x}   cy={w.to.y}   r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
                      {state === "transmitting" ? (
                        <circle r={3.2} fill="#fff" stroke={color} strokeWidth={1.8}>
                          <animateMotion dur="1.1s" repeatCount="indefinite" path={w.d} />
                        </circle>
                      ) : null}
                    </g>
                  );
                })}

                {/* Reverse arc (revise loop) */}
                <g>
                  <path
                    d={geo.arc.d}
                    stroke={arcColor}
                    strokeWidth={2.25}
                    fill="none"
                    strokeDasharray="5 4"
                    strokeLinecap="round"
                  />
                  <circle cx={geo.arc.from.x} cy={geo.arc.from.y} r={3.5} fill={arcColor} stroke="#fff" strokeWidth={1.5} />
                  <circle cx={geo.arc.to.x}   cy={geo.arc.to.y}   r={3.5} fill={arcColor} stroke="#fff" strokeWidth={1.5} />
                  {arcState === "transmitting" ? (
                    <circle r={3.2} fill="#fff" stroke={arcColor} strokeWidth={1.8}>
                      <animateMotion dur="1.4s" repeatCount="indefinite" path={geo.arc.d} />
                    </circle>
                  ) : null}
                </g>
              </svg>
            ) : null}

            {/* Revise chip (positioned over the arc peak) */}
            {geo ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: geo.arc.labelX,
                  transform: "translateX(-50%)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  color: arcColor,
                  background: "#fff",
                  border: `1.5px solid ${arcColor}`,
                  borderRadius: 999,
                  padding: "3px 12px 3px 8px",
                  whiteSpace: "nowrap",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  zIndex: 3,
                }}
                title="Pipeline always feeds Judge feedback back to Generator for one revision pass (MAX_REVISION_LOOPS)."
              >
                <LoopIcon color={arcColor} size={13} />
                <span>Revise loop {revisionCount > 0 ? `· fired ${revisionCount}×` : "· forced 1×"}</span>
              </div>
            ) : null}

            <div className="pipeline-flow">
              {NODES.map((n, i) => {
                const status = statuses[n.key];
                const summary = summaryFor(n.key, trace);
                return (
                  <FlowSegment
                    key={n.key}
                    index={i}
                    node={n}
                    status={status}
                    summary={summary}
                    showArrow={i < NODES.length - 1}
                  />
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* === Token usage (actual, populated as pipeline runs) === */}
      {trace?.token_usage?.total_tokens ? <TokenUsage usage={trace.token_usage} /> : null}

      {/* === View mode toggle === */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="muted" style={{ fontSize: 12 }}>Per-node input / output for the LangGraph pipeline.</div>
        <div className="segmented">
          <button className={`chip ${mode === "pretty" ? "active" : ""}`} onClick={() => setMode("pretty")}>Pretty</button>
          <button className={`chip ${mode === "json" ? "active" : ""}`} onClick={() => setMode("json")}>Raw JSON</button>
        </div>
      </div>

      {/* === Per-node detail cards === */}
      {NODES.map((n, i) => {
        const status = statuses[n.key];
        const isOpen = expanded.has(n.key);
        return (
          <div key={n.key} className="card">
            <header
              className="card-header"
              style={{ alignItems: "center", cursor: "pointer", userSelect: "none" }}
              onClick={() => toggle(n.key)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <StatusIcon status={status} />
                <div>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Node {i + 1}</div>
                  <div style={{ fontWeight: 700 }}>{n.title}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{n.subtitle}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={`badge ${status === "done" ? "completed" : status === "running" ? "running" : status === "failed" ? "failed" : "pending"}`}>
                  {STATUS_LABEL[status]}
                </span>
                <span className="muted" style={{ fontSize: 16, lineHeight: 1 }}>{isOpen ? "▾" : "▸"}</span>
              </div>
            </header>
            {isOpen ? (
              <div className="card-body grid-2">
                <div>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Input</div>
                  {mode === "pretty" ? renderPrettyInput(n.key) : <JsonBlock value={inputs[n.key]} />}
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Output</div>
                  {mode === "pretty" ? renderPrettyOutput(n.key) : <JsonBlock value={outputs[n.key]} />}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function LoopIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M 13.5 5 A 5.5 5.5 0 1 0 14 9.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      <polygon points="10,1 14.2,4.5 9.6,5.6" fill={color} />
    </svg>
  );
}

function FlowSegment({
  index, node, status, summary, showArrow,
}: {
  index: number;
  node: { key: NodeKey; title: string; subtitle: string };
  status: NodeStatus;
  summary: string | null;
  showArrow: boolean;
}) {
  return (
    <>
      <div className={`flow-node ${status}`} data-node={node.key}>
        <span className="flow-idx">Node {index + 1}</span>
        <span className="flow-name">{node.title}</span>
        <span className="flow-status">
          <StatusIcon status={status} />
          {STATUS_LABEL[status]}
        </span>
        {summary ? <div className="flow-meta">{summary}</div> : null}
      </div>
      {showArrow ? <span className="flow-arrow" aria-hidden /> : null}
    </>
  );
}
