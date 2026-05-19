import type { ReactNode } from "react";
import type { QuestionItem } from "../../types/api";

const FREE_TEXT = new Set(["short_answer", "essay", "speaking_prompt"]);

function extrasOf(item: QuestionItem): Record<string, any> | null {
  const opts = item.options as any;
  if (opts?._extras) return opts._extras;
  return null;
}

function LetterOptions({ item, showAnswer }: { item: QuestionItem; showAnswer: boolean }) {
  const opts = (item.options || {}) as Record<string, any>;
  const letters = ["A", "B", "C", "D"];
  const present = letters.filter((L) => opts[L] != null && String(opts[L]).trim() !== "");
  if (!present.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {present.map((L) => (
        <div
          key={L}
          className={`option-row ${showAnswer && L === item.correct_answer ? "correct" : ""}`}
        >
          <strong>{L}.</strong> {String(opts[L])}
        </div>
      ))}
    </div>
  );
}

function ReorderingBody({ item, showAnswer }: { item: QuestionItem; showAnswer: boolean }) {
  const opts = (item.options || {}) as Record<string, any>;
  const letters = ["A", "B", "C", "D"];
  const present = letters.filter((L) => opts[L] != null && String(opts[L]).trim() !== "");
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
        Lines to reorder
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {present.map((L) => (
          <li
            key={L}
            style={{
              border: "1px dashed #cbd5e1",
              borderRadius: 6, background: "#f8fafc",
              padding: "8px 12px", marginTop: 6,
              display: "flex", gap: 10, alignItems: "center",
            }}
          >
            <span
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, borderRadius: "50%",
                background: "#e2e8f0", color: "#475569",
                fontSize: 12, fontWeight: 700,
              }}
            >
              {L}
            </span>
            <span style={{ fontSize: 13 }}>{String(opts[L])}</span>
          </li>
        ))}
      </ul>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Type the correct order, separated by commas (e.g., <span className="mono">C, A, D, B</span>).
      </div>
      {showAnswer && item.correct_answer ? (
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Correct order: <strong style={{ color: "var(--success)" }}>{item.correct_answer}</strong>
        </div>
      ) : null}
    </div>
  );
}

function MatchingBody({ item, showAnswer }: { item: QuestionItem; showAnswer: boolean }) {
  const opts = (item.options || {}) as Record<string, any>;
  const left: string[] = Array.isArray(opts.left) ? opts.left : [];
  const right: string[] = Array.isArray(opts.right) ? opts.right : [];
  return (
    <div style={{ marginTop: 8 }}>
      <div className="grid-2">
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Column A</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {left.map((t, i) => <li key={i} style={{ marginTop: 4 }}>{t}</li>)}
          </ol>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Column B</div>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13, listStyleType: "upper-alpha" }}>
            {right.map((t, i) => <li key={i} style={{ marginTop: 4 }}>{t}</li>)}
          </ol>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Pair each item with its match (e.g., <span className="mono">1-B, 2-A, 3-C</span>).
      </div>
      {showAnswer && item.correct_answer ? (
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Correct pairing: <strong style={{ color: "var(--success)" }}>{item.correct_answer}</strong>
        </div>
      ) : null}
    </div>
  );
}

function ErrorIDBody({ item, showAnswer }: { item: QuestionItem; showAnswer: boolean }) {
  const ex = extrasOf(item) || {};
  return (
    <>
      <LetterOptions item={item} showAnswer={showAnswer} />
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Identify the segment that contains an error.
      </div>
      {showAnswer && ex.correction ? (
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Corrected sentence: <strong style={{ color: "var(--text)" }}>{String(ex.correction)}</strong>
        </div>
      ) : null}
    </>
  );
}

function FreeTextBody({ item, showAnswer }: { item: QuestionItem; showAnswer: boolean }) {
  const ex = extrasOf(item) || {};
  const meta: string[] = [];
  if (ex.min_words || ex.max_words) meta.push(`Length: ${ex.min_words ?? "?"}–${ex.max_words ?? "?"} words`);
  if (ex.max_words && !ex.min_words) meta.push(`Up to ${ex.max_words} words`);
  if (ex.prep_seconds || ex.response_seconds) meta.push(`Prep ${ex.prep_seconds ?? "?"}s · Response ${ex.response_seconds ?? "?"}s`);
  if (Array.isArray(ex.rubric) && ex.rubric.length) meta.push(`Rubric: ${ex.rubric.join(", ")}`);
  return (
    <>
      {meta.length ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{meta.join(" · ")}</div> : null}
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Write your response below.
      </div>
      {showAnswer && item.correct_answer ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--primary)" }}>Show model answer</summary>
          <div style={{ marginTop: 4, padding: "8px 10px", background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
            {item.correct_answer}
          </div>
        </details>
      ) : null}
    </>
  );
}

export function QuestionRenderer({ item, showAnswer = false }: { item: QuestionItem; showAnswer?: boolean }) {
  const t = item.question_type || "";

  let body: ReactNode;
  if (t === "reordering") body = <ReorderingBody item={item} showAnswer={showAnswer} />;
  else if (t === "matching") body = <MatchingBody item={item} showAnswer={showAnswer} />;
  else if (t === "error_identification") body = <ErrorIDBody item={item} showAnswer={showAnswer} />;
  else if (FREE_TEXT.has(t)) body = <FreeTextBody item={item} showAnswer={showAnswer} />;
  else body = <LetterOptions item={item} showAnswer={showAnswer} />;

  return (
    <div className="question-card">
      <div style={{ fontWeight: 650, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.stem}</div>
      {body}
      {showAnswer && item.correct_answer && t !== "reordering" && t !== "matching" ? (
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Answer: <strong style={{ color: "var(--success)" }}>{item.correct_answer}</strong>
        </div>
      ) : null}
      {showAnswer && item.explanation ? (
        <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{item.explanation}</div>
      ) : null}
    </div>
  );
}
