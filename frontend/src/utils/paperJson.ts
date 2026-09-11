import type { Paper, PaperSection, QuestionItem } from "../types/api";

export interface PaperJsonExport {
  format: "english-test/paper";
  version: "1.0";
  exported_at: string;
  includes_answers: boolean;
  paper: {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    total_score?: number | null;
    time_limit_min?: number | null;
    created_at?: string;
    completed_at?: string | null;
  };
  sections: Array<{
    id: string;
    name: string;
    skill: string;
    cefr: string;
    topic?: string | null;
    passage_length?: string | null;
    item_count: number;
    section_score: number;
    section_time_min?: number | null;
    passage_id?: string | null;
    passage_content?: string | null;
    items: ExportedItem[];
  }>;
}

interface ExportedItem {
  id: string;
  stem: string;
  question_type?: string | null;
  options?: Record<string, any> | null;
  cefr_level?: string | null;
  difficulty?: number | null;
  difficulty_band?: string | null;
  score_weight?: number | null;
  objective?: string | null;
  tags?: string[] | null;
  correct_answer?: string | null;
  explanation?: string | null;
  judge_score?: number | null;
}

function stripAnswers(item: ExportedItem): ExportedItem {
  const { correct_answer: _ca, explanation: _ex, judge_score: _js, options, ...rest } = item;
  let cleanedOptions = options;
  if (options && typeof options === "object") {
    const { _extras, ...opts } = options as Record<string, any>;
    const extrasClean = _extras && typeof _extras === "object"
      ? Object.fromEntries(Object.entries(_extras).filter(([k]) => k !== "correction"))
      : undefined;
    cleanedOptions = extrasClean && Object.keys(extrasClean).length > 0
      ? { ...opts, _extras: extrasClean }
      : opts;
  }
  return { ...rest, options: cleanedOptions };
}

function toExportedItem(it: QuestionItem): ExportedItem {
  return {
    id: it.id,
    stem: it.stem,
    question_type: it.question_type,
    options: it.options,
    cefr_level: it.cefr_level,
    difficulty: it.difficulty,
    difficulty_band: it.difficulty_band,
    score_weight: it.score_weight,
    objective: it.objective,
    tags: it.tags,
    correct_answer: it.correct_answer,
    explanation: it.explanation,
    judge_score: it.judge_score,
  };
}

export function buildPaperJson(
  paper: Paper,
  items: QuestionItem[],
  opts: { includeAnswers?: boolean } = {},
): PaperJsonExport {
  const includeAnswers = opts.includeAnswers ?? true;
  const itemsBySection: Record<string, QuestionItem[]> = {};
  for (const it of items) {
    const key = it.section_name || "";
    if (!itemsBySection[key]) itemsBySection[key] = [];
    itemsBySection[key].push(it);
  }

  const sections = paper.sections.map((sec: PaperSection) => {
    const secItems = (itemsBySection[sec.name] || []).map(toExportedItem);
    return {
      id: sec.id,
      name: sec.name,
      skill: sec.skill,
      cefr: sec.cefr,
      topic: sec.topic,
      passage_length: sec.passage_length,
      item_count: sec.item_count,
      section_score: sec.section_score,
      section_time_min: sec.section_time_min,
      passage_id: sec.passage_id,
      passage_content: sec.passage_content,
      items: includeAnswers ? secItems : secItems.map(stripAnswers),
    };
  });

  return {
    format: "english-test/paper",
    version: "1.0",
    exported_at: new Date().toISOString(),
    includes_answers: includeAnswers,
    paper: {
      id: paper.id,
      name: paper.name,
      description: paper.description,
      status: paper.status,
      total_score: paper.total_score,
      time_limit_min: paper.time_limit_min,
      created_at: paper.created_at,
      completed_at: paper.completed_at,
    },
    sections,
  };
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80) || "paper";
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPaperJson(
  paper: Paper,
  items: QuestionItem[],
  opts: { includeAnswers?: boolean } = {},
): void {
  const data = buildPaperJson(paper, items, opts);
  const suffix = opts.includeAnswers === false ? "test" : "full";
  downloadJsonFile(`${safeFilename(paper.name)}_${suffix}.json`, data);
}

export function downloadPapersBundleJson(
  entries: Array<{ paper: Paper; items: QuestionItem[] }>,
  opts: { includeAnswers?: boolean } = {},
): void {
  const bundle = {
    format: "english-test/paper-bundle" as const,
    version: "1.0" as const,
    exported_at: new Date().toISOString(),
    includes_answers: opts.includeAnswers ?? true,
    count: entries.length,
    papers: entries.map((e) => buildPaperJson(e.paper, e.items, opts)),
  };
  const suffix = opts.includeAnswers === false ? "test" : "full";
  downloadJsonFile(`papers_export_${entries.length}_${suffix}.json`, bundle);
}
