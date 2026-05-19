import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { getSessionResult } from "../services/sessionsApi";

export function SessionResultPage() {
  const { sessionId = "" } = useParams();
  const result = useQuery({
    queryKey: ["session-result", sessionId],
    queryFn: () => getSessionResult(sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => query.state.data?.status === "scored" ? false : 2000,
  });

  if (result.isLoading) return <LoadingState />;
  if (result.error) return <ErrorState error={result.error} />;
  if (!result.data) return null;

  const pct = result.data.max_score ? Math.round(((result.data.total_score || 0) / result.data.max_score) * 100) : 0;
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Session Result</h1>
          <p className="page-subtitle">{sessionId}</p>
        </div>
        <Badge status={result.data.status} />
      </header>
      <Card>
        <CardHeader title="Summary" />
        <div className="card-body stack">
          <div className="grid-3">
            <div className="question-card"><div className="muted">Overall CEFR</div><h2>{result.data.overall_cefr || "-"}</h2></div>
            <div className="question-card"><div className="muted">Score</div><h2>{result.data.total_score || 0} / {result.data.max_score || 0}</h2></div>
            <div className="question-card"><div className="muted">Percent</div><h2>{pct}%</h2></div>
          </div>
          {result.data.verdict ? <p>{result.data.verdict}</p> : <p className="muted">Result is not scored yet.</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Skill Breakdown" />
        <div className="card-body grid-3">
          {Object.entries(result.data.skill_cefr || {}).map(([skill, level]) => (
            <div key={skill} className="question-card"><div className="muted">{skill}</div><strong>{level}</strong></div>
          ))}
        </div>
      </Card>
    </div>
  );
}
