import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { ErrorState, LoadingState } from "../components/ui/States";
import { QuestionRenderer } from "../components/domain/QuestionRenderer";
import { listPapers } from "../services/papersApi";
import { startSession, submitAnswer, submitSession } from "../services/sessionsApi";

export function SessionTakePage() {
  const [paperId, setPaperId] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const papers = useQuery({ queryKey: ["ready-papers"], queryFn: () => listPapers(new URLSearchParams({ limit: "50" })) });
  const start = useMutation({ mutationFn: startSession });
  const answer = useMutation({ mutationFn: ({ itemId, value }: { itemId: string; value: string }) => submitAnswer(start.data!.session_id, { item_id: itemId, answer: value }) });
  const submit = useMutation({ mutationFn: () => submitSession(start.data!.session_id) });
  const ready = papers.data?.filter((paper) => paper.status === "completed" || paper.status === "partial") || [];

  if (start.data) {
    return (
      <div className="stack">
        <header className="page-header">
          <div>
            <h1 className="page-title">{start.data.paper_name}</h1>
            <p className="page-subtitle">Session {start.data.session_id}</p>
          </div>
          {submit.data ? <Link className="btn primary" to={`/sessions/${start.data.session_id}/result`}>View result</Link> : <Button variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending}>Submit test</Button>}
        </header>
        {start.data.items.map((item, index) => (
          <Card key={item.id}>
            <div className="card-body stack">
              <div className="muted">Question {index + 1} · {item.question_type}</div>
              <QuestionRenderer item={item} />
              <Field label="Your answer">
                <textarea
                  value={answers[item.id] || ""}
                  onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                  onBlur={(event) => answer.mutate({ itemId: item.id, value: event.target.value })}
                />
              </Field>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Take a Test</h1>
          <p className="page-subtitle">Start a candidate session from a completed or partially completed paper.</p>
        </div>
      </header>
      <Card>
        <CardHeader title="Start Session" />
        <div className="card-body stack">
          {papers.isLoading ? <LoadingState /> : papers.error ? <ErrorState error={papers.error} /> : (
            <div className="grid-2">
              <Field label="Paper">
                <select value={paperId} onChange={(event) => setPaperId(event.target.value)}>
                  <option value="">Select paper</option>
                  {ready.map((paper) => <option key={paper.id} value={paper.id}>{paper.name} [{paper.status}]</option>)}
                </select>
              </Field>
              <Field label="Candidate name">
                <input value={candidateName} onChange={(event) => setCandidateName(event.target.value)} placeholder="Anonymous" />
              </Field>
            </div>
          )}
          <Button variant="primary" disabled={!paperId || start.isPending} onClick={() => start.mutate({ paper_id: paperId, candidate_name: candidateName || "Anonymous" })}>Start test</Button>
          {start.error ? <ErrorState error={start.error} /> : null}
        </div>
      </Card>
    </div>
  );
}
