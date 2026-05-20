import type { Paper, PaperSection, QuestionItem } from "../types/api";

export interface SkillGroupMeta { key: string; label: string; order: number }

export function getSkillGroup(skill: string | null | undefined): SkillGroupMeta {
  const s = (skill || "").toLowerCase();
  if (s === "vocabulary") return { key: "vocabulary", label: "Vocabulary", order: 1 };
  if (s === "grammar")    return { key: "grammar",    label: "Grammar",    order: 2 };
  if (s === "integrated") return { key: "integrated", label: "Conversation / Functional English", order: 3 };
  if (s === "reading")    return { key: "reading",    label: "Reading",    order: 4 };
  if (s === "listening")  return { key: "listening",  label: "Listening",  order: 5 };
  if (s === "writing")    return { key: "writing",    label: "Writing",    order: 6 };
  if (s === "speaking")   return { key: "speaking",   label: "Speaking",   order: 7 };
  return { key: s || "other", label: skill || "Other", order: 99 };
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the inner body HTML for one paper (without <html>/<head>/<body> wrapper).
 * Used standalone or combined into a bulk print document.
 */
export function buildPaperBody(paper: Paper, items: QuestionItem[], includeAnswers: boolean): string {
  const itemsBySection: Record<string, QuestionItem[]> = {};
  for (const it of items) {
    const key = it.section_name || "";
    if (!itemsBySection[key]) itemsBySection[key] = [];
    itemsBySection[key].push(it);
  }

  let body = `
    <h1>${escapeHtml(paper.name)}${includeAnswers ? " <span class=\"key-tag\">— Answer Key</span>" : ""}</h1>
    <div class="meta">
      ${paper.description ? escapeHtml(paper.description) + " · " : ""}
      Total ${paper.total_score ?? "—"} points · Time ${paper.time_limit_min ?? "—"} min · ${paper.sections.length} sections
      <br/>Generated ${new Date().toLocaleString()}
    </div>
    <h3>Instructions</h3>
    <ul class="instructions">
      <li>Answer every question. There is no penalty for wrong answers.</li>
      <li>For multiple-choice questions, circle the letter of the correct option.</li>
      <li>For fill-in-the-blank and short-answer questions, write your answer in the space provided.</li>
      <li>For essays, write in complete sentences within the given word range.</li>
    </ul>
  `;

  type PrintGroup = {
    meta: SkillGroupMeta;
    subsections: PaperSection[];
    totalItems: number;
    totalScore: number;
    totalTime: number;
  };
  const groupMap = new Map<string, PrintGroup>();
  for (const sec of paper.sections) {
    const meta = getSkillGroup(sec.skill);
    if (!groupMap.has(meta.key)) {
      groupMap.set(meta.key, { meta, subsections: [], totalItems: 0, totalScore: 0, totalTime: 0 });
    }
    const g = groupMap.get(meta.key)!;
    g.subsections.push(sec);
    g.totalItems += Number(sec.item_count || 0);
    g.totalScore += Number(sec.section_score || 0);
    g.totalTime  += Number(sec.section_time_min || 0);
  }
  const printGroups = Array.from(groupMap.values()).sort((a, b) => a.meta.order - b.meta.order);

  let globalCounter = 0;
  printGroups.forEach((group, gIdx) => {
    const groupLabel = group.subsections.length === 1
      ? group.subsections[0].name
      : group.meta.label;
    body += `<section class="section">`;
    body += `<h2>Section ${gIdx + 1}: ${escapeHtml(groupLabel)}</h2>`;
    body += `<div class="meta">${group.totalItems} items · ${group.totalScore} points${group.totalTime ? ` · ${group.totalTime} min` : ""}</div>`;

    group.subsections.forEach((sec) => {
      const secItems = itemsBySection[sec.name] || [];

      if (sec.passage_content) {
        body += `<div class="passage">${escapeHtml(sec.passage_content).replace(/\n/g, "<br/>")}</div>`;
      }

      secItems.forEach((it) => {
        globalCounter += 1;
        const num = globalCounter;
        const opts = it.options
          ? Object.entries(it.options).filter(([k]) => k !== "_extras" && /^[A-D]$/.test(k))
          : [];
        const isFreeText = ["essay", "short_answer"].includes(it.question_type || "");
        const isFillBlank = it.question_type === "fill_blank";

        body += `<div class="q-block">`;
        if (it.question_type === "error_identification") {
          body += `<div class="q-prompt">Identify the <strong>incorrect</strong> part of the sentence.</div>`;
        }
        body += `<div class="q-stem">${num}. ${escapeHtml(it.stem)}</div>`;

        if (opts.length) {
          opts.forEach(([k, v]) => {
            const correct = includeAnswers && k === it.correct_answer;
            const cls = correct ? "q-opt q-correct" : "q-opt";
            body += `<div class="${cls}">${k}. ${escapeHtml(v)}${correct ? "  ✓" : ""}</div>`;
          });
        } else if (isFillBlank) {
          body += `<div class="q-opt">Answer: ${
            includeAnswers
              ? `<strong class="q-correct">${escapeHtml(it.correct_answer || "")}</strong>`
              : '<span class="blank-line"></span>'
          }</div>`;
        } else if (isFreeText) {
          if (includeAnswers) {
            body += `<div class="q-opt"><em>Model answer:</em><br/>${escapeHtml(it.correct_answer || "").replace(/\n/g, "<br/>")}</div>`;
          } else {
            body += `<div class="write-box ${it.question_type === "essay" ? "tall" : "short"}"></div>`;
          }
        }

        const extras = (it.options && (it.options as any)._extras) || {};
        if (includeAnswers && it.question_type === "error_identification" && extras.correction) {
          body += `<div class="correction"><strong>Corrected:</strong> ${escapeHtml(String(extras.correction))}</div>`;
        }
        if (includeAnswers && it.explanation) {
          body += `<div class="explanation">Explanation: ${escapeHtml(it.explanation)}</div>`;
        }
        body += `</div>`;
      });
    });
    body += `</section>`;
  });

  if (includeAnswers) {
    body += `<section class="section answer-key-section">`;
    body += `<h2>Answer Key Summary</h2>`;
    body += `<table class="answer-key">`;
    body += `<thead><tr><th>#</th><th>Section</th><th>Type</th><th>CEFR</th><th>Answer</th></tr></thead><tbody>`;
    let n = 1;
    printGroups.forEach((group) => {
      const groupLabel = group.subsections.length === 1
        ? group.subsections[0].name
        : group.meta.label;
      group.subsections.forEach((sec) => {
        (itemsBySection[sec.name] || []).forEach((it) => {
          body += `<tr>
            <td>${n++}</td>
            <td>${escapeHtml(groupLabel)}</td>
            <td>${escapeHtml(it.question_type || "")}</td>
            <td>${escapeHtml(it.cefr_level || "—")}</td>
            <td><strong>${escapeHtml((it.correct_answer || "").slice(0, 80))}</strong></td>
          </tr>`;
        });
      });
    });
    body += `</tbody></table></section>`;
  }

  return body;
}

/** Standard print styles + auto-print script wrapper. */
export function wrapPrintDocument(title: string, innerBody: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 18mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'Helvetica', 'Arial', sans-serif; color: #111; font-size: 12px; line-height: 1.45; }
    h1 { font-size: 20px; font-weight: bold; margin: 0 0 4px; }
    h1 .key-tag { font-size: 13px; font-weight: 600; color: #b91c1c; }
    h2 { font-size: 15px; font-weight: bold; margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid #444; }
    h3 { font-size: 13px; font-weight: bold; margin: 10px 0 6px; }
    .meta { font-size: 11px; color: #555; margin-bottom: 10px; }
    .instructions { font-size: 11px; padding-left: 18px; margin: 6px 0 14px; }
    .instructions li { margin-bottom: 2px; }
    .section { margin-bottom: 14px; page-break-inside: auto; }
    .section + .section { page-break-before: auto; }
    .passage { font-size: 12px; line-height: 1.5; margin: 6px 0 10px; padding: 8px 12px; background: #f4f4f4; border-left: 3px solid #999; page-break-inside: avoid; }
    .q-block { margin-bottom: 10px; page-break-inside: avoid; }
    .q-prompt { font-size: 11px; color: #475569; font-style: italic; margin-bottom: 2px; }
    .q-stem { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
    .q-opt { font-size: 12px; margin-left: 16px; margin-bottom: 2px; }
    .q-correct { color: #15803d; font-weight: bold; }
    .correction { margin: 6px 0 0 28px; padding: 6px 10px; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 4px; font-size: 12px; color: #14532d; }
    .blank-line { display: inline-block; border-bottom: 1px solid #444; min-width: 200px; height: 1em; vertical-align: middle; }
    .write-box { border: 1px solid #aaa; margin-top: 6px; }
    .write-box.short { height: 60px; }
    .write-box.tall { height: 180px; }
    .explanation { font-size: 10px; color: #555; margin-top: 4px; font-style: italic; }
    .answer-key-section { page-break-before: always; }
    table.answer-key { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.answer-key th, table.answer-key td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; }
    table.answer-key thead { display: table-header-group; }
    table.answer-key tr { page-break-inside: avoid; }
    .paper-divider { page-break-before: always; }
    @media screen {
      body { max-width: 780px; margin: 0 auto; padding: 24px; background: #fff; }
      .print-hint { position: fixed; top: 12px; right: 12px; background: #2563eb; color: white; padding: 10px 16px; border-radius: 6px; font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); cursor: pointer; }
    }
    @media print { .print-hint { display: none; } }
  </style>
</head>
<body>
  <div class="print-hint" onclick="window.print()">Click to print / Save as PDF</div>
  ${innerBody}
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 300);
    });
  <\/script>
</body>
</html>`;
}

export type ExportMode = "test" | "key" | "both";

/** Build a print doc for one paper given the mode. */
export function buildSinglePaperPrint(paper: Paper, items: QuestionItem[], mode: ExportMode): string {
  const parts: string[] = [];
  if (mode === "test" || mode === "both") parts.push(buildPaperBody(paper, items, false));
  if (mode === "both") parts.push('<div class="paper-divider"></div>');
  if (mode === "key" || mode === "both") parts.push(buildPaperBody(paper, items, true));
  const title = `${paper.name}${mode === "key" ? " — Answer Key" : mode === "both" ? " — Test + Key" : ""}`;
  return wrapPrintDocument(title, parts.join("\n"));
}

/** Build a print doc for multiple papers; papers separated by page break. */
export function buildBulkPaperPrint(
  inputs: Array<{ paper: Paper; items: QuestionItem[] }>,
  mode: ExportMode,
): string {
  const parts: string[] = [];
  inputs.forEach((entry, idx) => {
    if (idx > 0) parts.push('<div class="paper-divider"></div>');
    if (mode === "test" || mode === "both") {
      parts.push(buildPaperBody(entry.paper, entry.items, false));
    }
    if (mode === "both") parts.push('<div class="paper-divider"></div>');
    if (mode === "key" || mode === "both") {
      parts.push(buildPaperBody(entry.paper, entry.items, true));
    }
  });
  const title = `Papers Export (${inputs.length})${mode === "key" ? " — Answer Keys" : mode === "both" ? " — Tests + Keys" : ""}`;
  return wrapPrintDocument(title, parts.join("\n"));
}

/** Open the print HTML in a new window. Returns false if popups are blocked. */
export function openPrintWindow(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
