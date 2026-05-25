import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { getPaperItems, listPapers } from "../services/papersApi";
import type { Paper, QuestionItem } from "../types/api";
import { buildSinglePaperPrint, openPrintWindow, type ExportMode } from "../utils/paperPrint";
import { downloadPaperJson, downloadPapersBundleJson } from "../utils/paperJson";

type ExportFormat = "pdf" | "json" | "json-bundle";

function isReady(status: string | null | undefined) {
  return status === "completed" || status === "partial";
}

export function PaperListPage() {
  const query = useQuery({ queryKey: ["papers"], queryFn: () => listPapers(new URLSearchParams({ limit: "50" })) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);

  const papers = query.data || [];
  const readyPapers = useMemo(() => papers.filter((p) => isReady(p.status)), [papers]);
  const allReadySelected = readyPapers.length > 0 && readyPapers.every((p) => selected.has(p.id));
  const selectedPapers = useMemo(
    () => papers.filter((p) => selected.has(p.id) && isReady(p.status)),
    [papers, selected],
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allReadySelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(readyPapers.map((p) => p.id)));
    }
  };

  const clearSelection = () => setSelected(new Set());

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Papers</h1>
          <p className="page-subtitle">Review generated paper tests, open details, or bulk-export to PDF.</p>
        </div>
        <Link className="btn primary" to="/papers/new">Create paper</Link>
      </header>

      <Card>
        <CardHeader
          title="All Papers"
          description={`${papers.length} total · ${readyPapers.length} ready for export`}
          actions={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {selected.size > 0 ? (
                <>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {selected.size} selected
                  </span>
                  <Button onClick={clearSelection}>Clear</Button>
                  <Button variant="primary" onClick={() => setShowExport(true)}>
                    📄 Export selected
                  </Button>
                </>
              ) : null}
            </div>
          }
        />
        {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allReadySelected}
                      onChange={toggleAll}
                      disabled={readyPapers.length === 0}
                      aria-label="Select all ready papers"
                      title={readyPapers.length === 0 ? "No ready papers" : allReadySelected ? "Deselect all" : "Select all ready papers"}
                    />
                  </th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Sections</th>
                  <th>Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {papers.map((paper) => {
                  const ready = isReady(paper.status);
                  return (
                    <tr key={paper.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(paper.id)}
                          onChange={() => toggleOne(paper.id)}
                          disabled={!ready}
                          aria-label={`Select ${paper.name}`}
                          title={ready ? "Select for bulk export" : "Only completed papers can be exported"}
                        />
                      </td>
                      <td>{paper.name}</td>
                      <td><Badge status={paper.status} /></td>
                      <td>{paper.sections.length}</td>
                      <td>{paper.total_score || "-"}</td>
                      <td><Link className="btn" to={`/papers/${paper.id}`}>Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showExport ? (
        <BulkExportModal
          papers={selectedPapers}
          onClose={() => setShowExport(false)}
        />
      ) : null}
    </div>
  );
}

function BulkExportModal({ papers, onClose }: { papers: Paper[]; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [mode, setMode] = useState<ExportMode>("test");

  const changeFormat = (next: ExportFormat) => {
    setFormat(next);
    if (next !== "pdf" && mode === "both") setMode("key");
  };

  const exportMutation = useMutation({
    mutationFn: async ({ selectedFormat, selectedMode }: { selectedFormat: ExportFormat; selectedMode: ExportMode }) => {
      // Fetch items for every paper in parallel
      const results = await Promise.all(
        papers.map(async (paper) => {
          const items = await getPaperItems(paper.id);
          return { paper, items };
        }),
      );

      if (selectedFormat === "json") {
        // One JSON file per paper. "test" mode strips answers; "key" and "both" keep them.
        const includeAnswers = selectedMode !== "test";
        for (const { paper, items } of results) {
          downloadPaperJson(paper, items, { includeAnswers });
        }
        return results;
      }

      if (selectedFormat === "json-bundle") {
        const includeAnswers = selectedMode !== "test";
        downloadPapersBundleJson(results, { includeAnswers });
        return results;
      }

      // PDF: open ONE window per paper so each becomes its own print/PDF file.
      // All window.open calls must happen in the same user-gesture tick,
      // otherwise the browser will block subsequent popups.
      const blocked: string[] = [];
      for (const { paper, items } of results) {
        const html = buildSinglePaperPrint(paper, items, selectedMode);
        const ok = openPrintWindow(html);
        if (!ok) blocked.push(paper.name);
      }
      if (blocked.length) {
        throw new Error(
          `Popup blocked for ${blocked.length} of ${results.length} paper${results.length === 1 ? "" : "s"}. ` +
          `Allow popups for this site and try again.\n\nBlocked: ${blocked.join(", ")}`,
        );
      }
      return results;
    },
    onSuccess: () => onClose(),
  });

  const handleConfirm = () => {
    exportMutation.mutate({ selectedFormat: format, selectedMode: mode });
  };

  const confirmLabel = (() => {
    if (exportMutation.isPending) return "Preparing...";
    if (format === "pdf") {
      return `Open ${papers.length} print window${papers.length === 1 ? "" : "s"}`;
    }
    if (format === "json-bundle") {
      return `Download 1 JSON file (${papers.length} paper${papers.length === 1 ? "" : "s"})`;
    }
    return `Download ${papers.length} JSON file${papers.length === 1 ? "" : "s"}`;
  })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-shell" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">Export {papers.length} paper{papers.length === 1 ? "" : "s"}</h2>
            <p className="modal-sub muted">
              {format === "pdf"
                ? `Each paper opens as its own print window — save each as a separate PDF.${papers.length > 1 ? " Allow popups when prompted." : ""}`
                : format === "json-bundle"
                  ? "All papers are bundled into one downloadable .json file."
                  : "Each paper downloads as its own .json file."}
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close" disabled={exportMutation.isPending}>✕</button>
        </div>

        <div className="modal-body stack">
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>Format</div>
            <div className="export-mode-list">
              <ExportFormatOption
                value="pdf"
                current={format}
                onSelect={changeFormat}
                label="📄 PDF (one window per paper)"
                description="Open each paper in a print window — Save as PDF from the browser dialog."
              />
              <ExportFormatOption
                value="json"
                current={format}
                onSelect={changeFormat}
                label="🗎 JSON (one file per paper)"
                description="Structured paper data — useful for re-import, automation, or archival."
              />
              <ExportFormatOption
                value="json-bundle"
                current={format}
                onSelect={changeFormat}
                label="📦 JSON bundle (one file total)"
                description="All selected papers wrapped into a single .json file."
              />
            </div>
          </div>

          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>
              {format === "pdf" ? "Content" : "Answers"}
            </div>
            <div className="export-mode-list">
              <ExportModeOption
                value="test"
                current={mode}
                onSelect={setMode}
                label={format === "pdf" ? "📄 Test paper only" : "🚫 Without answers"}
                description={format === "pdf"
                  ? "Student-facing test without answers — for printing and distribution."
                  : "Strip correct answers, explanations, and judge scores from the export."}
              />
              <ExportModeOption
                value="key"
                current={mode}
                onSelect={setMode}
                label={format === "pdf" ? "🔑 Answer key only" : "🔑 With answers"}
                description={format === "pdf"
                  ? "Marked test with correct answers, model responses, and answer key summary."
                  : "Include correct answers and explanations in the JSON output."}
              />
              {format === "pdf" ? (
                <ExportModeOption
                  value="both"
                  current={mode}
                  onSelect={setMode}
                  label="📄 + 🔑 Test paper + Answer key"
                  description="Both versions in one document — test pages first, then answer key. Convenient for proctors."
                />
              ) : null}
            </div>
          </div>

          <div className="export-paper-list">
            <div className="muted" style={{ fontSize: 12, fontWeight: 650, marginBottom: 4 }}>
              Papers in this export:
            </div>
            {papers.map((p) => (
              <div key={p.id} className="export-paper-row">
                <span>{p.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {p.sections.length} sections · {p.total_score || "—"} pts
                </span>
              </div>
            ))}
          </div>

          {exportMutation.error ? <ErrorState error={exportMutation.error} /> : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={exportMutation.isPending}>Cancel</button>
          <Button variant="primary" onClick={handleConfirm} disabled={exportMutation.isPending || papers.length === 0}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExportFormatOption({
  value, current, onSelect, label, description,
}: {
  value: ExportFormat;
  current: ExportFormat;
  onSelect: (v: ExportFormat) => void;
  label: string;
  description: string;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      className={`export-mode-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(value)}
    >
      <div className="export-mode-radio">
        <span className={`radio-dot ${selected ? "filled" : ""}`} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="export-mode-label">{label}</div>
        <div className="export-mode-desc">{description}</div>
      </div>
    </button>
  );
}

function ExportModeOption({
  value, current, onSelect, label, description,
}: {
  value: ExportMode;
  current: ExportMode;
  onSelect: (v: ExportMode) => void;
  label: string;
  description: string;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      className={`export-mode-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(value)}
    >
      <div className="export-mode-radio">
        <span className={`radio-dot ${selected ? "filled" : ""}`} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="export-mode-label">{label}</div>
        <div className="export-mode-desc">{description}</div>
      </div>
    </button>
  );
}
