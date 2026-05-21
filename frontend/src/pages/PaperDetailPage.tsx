import { useQueries, useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { TokenUsage } from "../components/domain/TokenEstimate";
import { getJob } from "../services/jobsApi";
import { getPaper, getPaperItems } from "../services/papersApi";
import type { JobResponse, Paper, PaperSection, QuestionItem } from "../types/api";
import { getSkillGroup, type SkillGroupMeta, buildSinglePaperPrint, openPrintWindow } from "../utils/paperPrint";

type NodeKey = "blueprint" | "generator" | "distractor" | "judge";
type NodeStatus = "waiting" | "running" | "done" | "failed";

const NODES: Array<{ key: NodeKey; title: string }> = [
  { key: "blueprint",  title: "Blueprint" },
  { key: "generator",  title: "Generator" },
  { key: "distractor", title: "Distractor" },
  { key: "judge",      title: "Judge" },
];

function isSectionDone(section: PaperSection) {
  const s = (section.status || "").toLowerCase();
  return s === "completed" || s === "scored" || s === "validated";
}
function isSectionFailed(section: PaperSection) {
  const s = (section.status || "").toLowerCase();
  return s === "failed" || s === "cancelled";
}

function deriveNodeStatus(node: NodeKey, job: JobResponse | undefined, section: PaperSection): NodeStatus {
  // Section already completed → all nodes done
  if (isSectionDone(section)) return "done";

  if (!job) {
    if (isSectionFailed(section)) return "failed";
    return "waiting";
  }
  const trace: any = (job.result as any)?.trace || {};
  const current = (job.current_node || "").toLowerCase();
  const isCurrent = current.includes(node);

  const hasOutput = (() => {
    switch (node) {
      case "blueprint":  return Boolean(trace?.blueprint);
      case "generator":  return Boolean(trace?.raw_questions?.length) || Boolean(trace?.passage);
      case "distractor": return Boolean(trace?.questions_with_options?.length);
      case "judge":      return Boolean(trace?.judge_results?.length);
    }
  })();

  if (job.status === "failed") {
    if (hasOutput) return "done";
    if (isCurrent) return "failed";
    // Mark the first node without output as failed; rest waiting
    const orderIdx = NODES.findIndex((n) => n.key === node);
    for (let i = 0; i < orderIdx; i++) {
      // earlier nodes already handled above
    }
    return hasOutput ? "done" : "failed";
  }

  if (hasOutput) return isCurrent && job.status === "running" ? "running" : "done";
  if (isCurrent && job.status === "running") return "running";
  return "waiting";
}

function NodeIcon({ status }: { status: NodeStatus }) {
  if (status === "running") return <span className="flow-spinner" aria-label="running" />;
  if (status === "done")    return <span className="flow-icon-check" aria-label="done">✓</span>;
  if (status === "failed")  return <span className="flow-icon-cross" aria-label="failed">✕</span>;
  return <span className="flow-icon-dot" aria-label="waiting" />;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  waiting: "Waiting",
  running: "Running…",
  done: "Done",
  failed: "Failed",
};

function summaryFor(node: NodeKey, trace: any): string | null {
  if (!trace) return null;
  switch (node) {
    case "blueprint": {
      const bp = trace.blueprint;
      if (!bp) return null;
      const bits: string[] = [];
      if (bp.skill) bits.push(bp.skill);
      if (bp.cefr) bits.push(bp.cefr);
      if (bp.item_count) bits.push(`${bp.item_count} items`);
      return bits.join(" · ") || null;
    }
    case "generator": {
      const qs = trace.raw_questions || [];
      const pasLen = (trace.passage || "").length;
      if (!qs.length && !pasLen) return null;
      return `${qs.length} q${pasLen ? ` · ${pasLen}c` : ""}`;
    }
    case "distractor": {
      const qs = trace.questions_with_options || [];
      return qs.length ? `${qs.length} finalized` : null;
    }
    case "judge": {
      const rs = trace.judge_results || [];
      if (!rs.length) return null;
      const passed = rs.filter((r: any) => r.pass === true).length;
      return `${passed}/${rs.length} pass${trace.revision_count ? ` · rev ${trace.revision_count}` : ""}`;
    }
  }
}

function SectionPipelineCard({ section }: { section: PaperSection }) {
  const sectionDone = isSectionDone(section);
  const jobId = section.job_id || "";
  const jobQuery = useQuery({
    queryKey: ["paper-section-job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId) && !sectionDone,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "pending" || status === "running") return 1500;
      return false;
    },
  });
  const job = jobQuery.data;
  const trace: any = (job?.result as any)?.trace || {};

  const statuses: Record<NodeKey, NodeStatus> = useMemo(
    () => ({
      blueprint:  deriveNodeStatus("blueprint", job, section),
      generator:  deriveNodeStatus("generator", job, section),
      distractor: deriveNodeStatus("distractor", job, section),
      judge:      deriveNodeStatus("judge", job, section),
    }),
    [job, section],
  );

  const doneCount = Object.values(statuses).filter((s) => s === "done").length;
  const isRunning = Object.values(statuses).some((s) => s === "running");
  const progressPct = (doneCount / NODES.length) * 100;

  return (
    <div className="section-pipeline">
      <div className="section-pipeline-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong>{section.name}</strong>
          <Badge status={section.status} />
          {isRunning ? <span className="pipeline-live-dot" title="Live" /> : null}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {section.skill} · {section.cefr} · {section.item_count} items · {section.section_score} pts
          {section.passage_length ? ` · ${section.passage_length}` : ""}
        </div>
      </div>

      <div className="section-pipeline-bar">
        <div
          className={`section-pipeline-bar-fill ${isSectionFailed(section) ? "failed" : isRunning ? "running" : ""}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="pipeline-flow" style={{ marginTop: 10 }}>
        {NODES.map((n, i) => {
          const status = statuses[n.key];
          const summary = summaryFor(n.key, trace);
          return (
            <Fragment key={n.key}>
              <div className={`flow-node ${status}`}>
                <span className="flow-idx">Node {i + 1}</span>
                <span className="flow-name">{n.title}</span>
                <span className="flow-status">
                  <NodeIcon status={status} />
                  {STATUS_LABEL[status]}
                </span>
                {summary ? <div className="flow-meta">{summary}</div> : null}
              </div>
              {i < NODES.length - 1 ? (
                <span className={`flow-arrow ${status === "done" ? "active" : ""}`} aria-hidden>→</span>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      {section.error_message ? (
        <div className="pipeline-error-banner">⚠ {section.error_message}</div>
      ) : null}

      {trace?.token_usage?.total_tokens ? (
        <div style={{ marginTop: 10 }}>
          <TokenUsage usage={trace.token_usage} />
        </div>
      ) : null}

      {section.passage_content ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--primary)", fontWeight: 600 }}>
            View generated passage
          </summary>
          <div style={{ marginTop: 6, padding: "10px 12px", background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {section.passage_content}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function PaperDetailPage() {
  const { paperId = "" } = useParams();
  const [showPreview, setShowPreview] = useState(false);

  const paper = useQuery({
    queryKey: ["paper", paperId],
    queryFn: () => getPaper(paperId),
    enabled: Boolean(paperId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "pending" || status === "running") return 2000;
      return false;
    },
  });

  const items = useQuery({
    queryKey: ["paper-items", paperId],
    queryFn: () => getPaperItems(paperId),
    enabled: Boolean(paperId) && (paper.data?.status === "completed" || paper.data?.status === "partial"),
  });

  const sectionJobIds = paper.data?.sections.map((s) => s.job_id || "").filter(Boolean) ?? [];
  const sectionJobs = useQueries({
    queries: sectionJobIds.map((jobId) => ({
      queryKey: ["paper-section-job", jobId],
      queryFn: () => getJob(jobId),
      enabled: Boolean(jobId),
    })),
  });

  const aggregateUsage = useMemo(() => {
    const totals = { input_tokens: 0, output_tokens: 0, total_tokens: 0, calls: 0, by_agent: {} as Record<string, { input_tokens: number; output_tokens: number; calls: number }> };
    for (const q of sectionJobs) {
      const usage: any = (q.data?.result as any)?.trace?.token_usage;
      if (!usage) continue;
      totals.input_tokens  += usage.input_tokens  || 0;
      totals.output_tokens += usage.output_tokens || 0;
      totals.total_tokens  += usage.total_tokens  || 0;
      totals.calls         += usage.calls         || 0;
      for (const [agent, v] of Object.entries(usage.by_agent || {}) as Array<[string, any]>) {
        const acc = totals.by_agent[agent] || { input_tokens: 0, output_tokens: 0, calls: 0 };
        acc.input_tokens  += v.input_tokens  || 0;
        acc.output_tokens += v.output_tokens || 0;
        acc.calls         += v.calls         || 0;
        totals.by_agent[agent] = acc;
      }
    }
    return totals.total_tokens ? totals : null;
  }, [sectionJobs]);

  if (paper.isLoading) return <LoadingState />;
  if (paper.error) return <ErrorState error={paper.error} />;
  if (!paper.data) return null;

  const total = paper.data.sections.length;
  const completed = paper.data.sections.filter(isSectionDone).length;
  const failed = paper.data.sections.filter(isSectionFailed).length;
  const inProgress = total - completed - failed;
  const overallPct = total ? (completed / total) * 100 : 0;
  const stillProcessing = paper.data.status === "pending" || paper.data.status === "running";
  const canExport = (paper.data.status === "completed" || paper.data.status === "partial") && Boolean(items.data?.length);

  const handleExport = (includeAnswers: boolean) => {
    if (!paper.data || !items.data) return;
    const html = buildSinglePaperPrint(paper.data, items.data, includeAnswers ? "key" : "test");
    const opened = openPrintWindow(html);
    if (!opened) alert("Popup blocked — please allow popups for this site.");
  };

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">{paper.data.name}</h1>
          <p className="page-subtitle">{paper.data.description || "Live generation progress — each section runs its own pipeline in parallel."}</p>
        </div>
        <div className="toolbar">
          <Badge status={paper.data.status} />
          <button
            type="button"
            className="btn primary"
            disabled={!canExport}
            onClick={() => setShowPreview(true)}
            title={canExport ? "Preview the formatted test paper" : "Available once generation finishes"}
          >
            👁 View Test
          </button>
          {/* <button
            type="button"
            className="btn"
            disabled={!canExport}
            onClick={() => handleExport(false)}
            title={canExport ? "Open the test paper in a new window for printing / Save as PDF" : "Available once generation finishes"}
          >
            📄 Test PDF
          </button> */}
          {/* <button
            type="button"
            className="btn"
            disabled={!canExport}
            onClick={() => handleExport(true)}
            title={canExport ? "Open the answer key in a new window for printing / Save as PDF" : "Available once generation finishes"}
          >
            🔑 Answer Key PDF
          </button> */}
          <Link className="btn" to="/sessions/take">Take test</Link>
        </div>
      </header>

      {/* Overall progress card */}
      <Card>
        <CardHeader
          title="Generation Progress"
          description={stillProcessing
            ? "Sections are generating in parallel. This view auto-refreshes."
            : "Paper generation finished."}
        />
        <div className="card-body stack">
          <div className="overall-stats">
            <StatPill label="Total sections" value={String(total)} />
            <StatPill label="Completed" value={String(completed)} tone="success" />
            <StatPill label="In progress" value={String(inProgress)} tone={inProgress > 0 ? "running" : undefined} />
            <StatPill label="Failed" value={String(failed)} tone={failed > 0 ? "danger" : undefined} />
          </div>
          <div className="overall-bar">
            <div className="overall-bar-fill" style={{ width: `${overallPct}%` }}>
              {overallPct >= 12 ? `${Math.round(overallPct)}%` : ""}
            </div>
          </div>
          {aggregateUsage ? <TokenUsage usage={aggregateUsage} /> : null}
        </div>
      </Card>

      {/* Per-section pipelines */}
      <Card>
        <CardHeader title="Sections" description={`${total} section${total === 1 ? "" : "s"} processing in parallel`} />
        <div className="card-body stack">
          {paper.data.sections.map((section) => (
            <SectionPipelineCard key={section.id} section={section} />
          ))}
        </div>
      </Card>

      {showPreview && paper.data && items.data ? (
        <PaperPreviewModal
          paper={paper.data}
          items={items.data}
          onClose={() => setShowPreview(false)}
          onPrint={(withAnswers) => handleExport(withAnswers)}
        />
      ) : null}
    </div>
  );
}

function PaperPreviewModal({
  paper, items, onClose, onPrint,
}: {
  paper: Paper;
  items: QuestionItem[];
  onClose: () => void;
  onPrint: (includeAnswers: boolean) => void;
}) {
  const [showAnswers, setShowAnswers] = useState(false);

  const itemsBySection = useMemo(() => {
    const map: Record<string, QuestionItem[]> = {};
    for (const it of items) {
      const key = it.section_name || "";
      if (!map[key]) map[key] = [];
      map[key].push(it);
    }
    return map;
  }, [items]);

  type Group = {
    meta: SkillGroupMeta;
    subsections: PaperSection[];
    totalItems: number;
    totalScore: number;
    totalTime: number;
  };

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const sec of paper.sections) {
      const meta = getSkillGroup(sec.skill);
      if (!map.has(meta.key)) {
        map.set(meta.key, { meta, subsections: [], totalItems: 0, totalScore: 0, totalTime: 0 });
      }
      const g = map.get(meta.key)!;
      g.subsections.push(sec);
      g.totalItems += Number(sec.item_count || 0);
      g.totalScore += Number(sec.section_score || 0);
      g.totalTime  += Number(sec.section_time_min || 0);
    }
    return Array.from(map.values()).sort((a, b) => a.meta.order - b.meta.order);
  }, [paper.sections]);

  let globalNum = 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-shell preview-shell" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">Test Paper Preview</h2>
            <p className="modal-sub muted">Formatted view as candidates / proctors would read it.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="preview-toggle">
              <input
                type="checkbox"
                checked={showAnswers}
                onChange={(event) => setShowAnswers(event.target.checked)}
              />
              <span>Show answers</span>
            </label>
            <button type="button" className="btn" onClick={() => onPrint(showAnswers)}>
              🖨 Print / PDF
            </button>
            <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="modal-body preview-body">
          <article className="paper-preview">
            <header className="preview-header">
              <h1>{paper.name}</h1>
              <div className="preview-meta">
                {paper.description ? <span>{paper.description} · </span> : null}
                Total {paper.total_score ?? "—"} points · Time {paper.time_limit_min ?? "—"} min · {paper.sections.length} sections
              </div>
              <div className="preview-instructions">
                <strong>Instructions</strong>
                <ul>
                  <li>Answer every question. There is no penalty for wrong answers.</li>
                  <li>For multiple-choice questions, circle the letter of the correct option.</li>
                  <li>For fill-in-the-blank and short-answer questions, write your answer in the space provided.</li>
                  <li>For essays, write in complete sentences within the given word range.</li>
                </ul>
              </div>
            </header>

            {groups.map((group, gIdx) => {
              const groupLabel = group.subsections.length === 1
                ? group.subsections[0].name
                : group.meta.label;
              return (
              <section key={group.meta.key} className="preview-section">
                <h2>Section {gIdx + 1}: {groupLabel}</h2>
                <div className="preview-meta">
                  {group.totalItems} items · {group.totalScore} points
                  {group.totalTime ? ` · ${group.totalTime} min` : ""}
                </div>

                {group.subsections.map((section) => {
                  const secItems = itemsBySection[section.name] || [];
                  return (
                    <Fragment key={section.id}>
                      {section.passage_content ? (
                        <div className="preview-passage">
                          <div className="preview-passage-label">Passage</div>
                          <div className="preview-passage-text">{section.passage_content}</div>
                        </div>
                      ) : null}

                      {secItems.map((it) => {
                        globalNum += 1;
                        return (
                          <PreviewQuestion
                            key={it.id}
                            item={it}
                            number={globalNum}
                            showAnswer={showAnswers}
                          />
                        );
                      })}
                    </Fragment>
                  );
                })}

                {group.subsections.every((s) => (itemsBySection[s.name] || []).length === 0) ? (
                  <div className="muted" style={{ fontSize: 13 }}>No items in this section.</div>
                ) : null}
              </section>
              );
            })}

            {showAnswers ? (
              <section className="preview-section">
                <h2>Answer Key Summary</h2>
                <table className="preview-answerkey">
                  <thead>
                    <tr>
                      <th>#</th><th>Section</th><th>Type</th><th>CEFR</th><th>Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let n = 0;
                      const rows: React.ReactNode[] = [];
                      groups.forEach((group) => {
                        const groupLabel = group.subsections.length === 1
                          ? group.subsections[0].name
                          : group.meta.label;
                        group.subsections.forEach((sec) => {
                          (itemsBySection[sec.name] || []).forEach((it) => {
                            n += 1;
                            rows.push(
                              <tr key={`${sec.id}-${it.id}`}>
                                <td>{n}</td>
                                <td>{groupLabel}</td>
                                <td>{it.question_type || ""}</td>
                                <td>{it.cefr_level || "—"}</td>
                                <td><strong>{(it.correct_answer || "").slice(0, 80)}</strong></td>
                              </tr>
                            );
                          });
                        });
                      });
                      return rows;
                    })()}
                  </tbody>
                </table>
              </section>
            ) : null}
          </article>
        </div>
      </div>
    </div>
  );
}

function PreviewQuestion({ item, number, showAnswer }: { item: QuestionItem; number: number; showAnswer: boolean }) {
  const opts = item.options
    ? Object.entries(item.options).filter(([k]) => k !== "_extras" && /^[A-D]$/.test(k))
    : [];
  const isFreeText = ["essay", "short_answer"].includes(item.question_type || "");
  const isFillBlank = item.question_type === "fill_blank";
  const isErrorId = item.question_type === "error_identification";
  const extras: Record<string, any> = ((item.options as any)?._extras) || {};

  return (
    <div className="preview-question">
      {isErrorId ? (
        <div className="preview-question-prompt">
          Identify the <strong>incorrect</strong> part of the sentence.
        </div>
      ) : null}

      <div className="preview-question-stem">
        <span className="preview-question-num">{number}.</span>
        <span style={{ whiteSpace: "pre-wrap" }}>{item.stem}</span>
        {showAnswer && item.question_type ? (
          <span className="preview-question-type">{item.question_type}</span>
        ) : null}
      </div>

      {opts.length ? (
        <div className="preview-options">
          {opts.map(([k, v]) => {
            const correct = showAnswer && k === item.correct_answer;
            return (
              <div key={k} className={`preview-option ${correct ? "correct" : ""}`}>
                <strong>{k}.</strong> <span>{String(v)}</span>
                {correct ? <span className="preview-correct-tag">✓ correct</span> : null}
              </div>
            );
          })}
        </div>
      ) : isFillBlank ? (
        <div className="preview-fill-blank">
          Answer: {showAnswer ? (
            <strong style={{ color: "var(--success)" }}>{item.correct_answer || "—"}</strong>
          ) : (
            <span className="preview-blank-line" />
          )}
        </div>
      ) : isFreeText ? (
        showAnswer ? (
          <div className="preview-model-answer">
            <em>Model answer:</em>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{item.correct_answer || "—"}</div>
          </div>
        ) : (
          <div className={`preview-write-box ${item.question_type === "essay" ? "tall" : "short"}`} />
        )
      ) : (
        showAnswer && item.correct_answer ? (
          <div className="preview-fill-blank">
            Answer: <strong style={{ color: "var(--success)" }}>{item.correct_answer}</strong>
          </div>
        ) : null
      )}

      {showAnswer && isErrorId && extras.correction ? (
        <div className="preview-correction">
          <strong>Corrected:</strong> {String(extras.correction)}
        </div>
      ) : null}

      {showAnswer && item.explanation ? (
        <div className="preview-explanation">
          <strong>Explanation:</strong> {item.explanation}
        </div>
      ) : null}
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: string; tone?: "success" | "running" | "danger" }) {
  return (
    <div className={`stat-pill ${tone || ""}`}>
      <div className="stat-pill-value">{value}</div>
      <div className="stat-pill-label">{label}</div>
    </div>
  );
}
