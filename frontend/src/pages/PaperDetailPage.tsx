import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { QuestionRenderer } from "../components/domain/QuestionRenderer";
import { getPaper, getPaperItems } from "../services/papersApi";

export function PaperDetailPage() {
  const { paperId = "" } = useParams();
  const paper = useQuery({ queryKey: ["paper", paperId], queryFn: () => getPaper(paperId), enabled: Boolean(paperId), refetchInterval: 3000 });
  const items = useQuery({ queryKey: ["paper-items", paperId], queryFn: () => getPaperItems(paperId), enabled: Boolean(paperId) });

  if (paper.isLoading) return <LoadingState />;
  if (paper.error) return <ErrorState error={paper.error} />;
  if (!paper.data) return null;

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">{paper.data.name}</h1>
          <p className="page-subtitle">{paper.data.description || "Paper detail and generated items."}</p>
        </div>
        <div className="toolbar"><Badge status={paper.data.status} /><Link className="btn" to="/sessions/take">Take test</Link></div>
      </header>
      <Card>
        <CardHeader title="Sections" />
        <div className="card-body stack">
          {paper.data.sections.map((section) => (
            <div className="question-card" key={section.id}>
              <strong>{section.name}</strong> <Badge status={section.status} />
              <div className="muted" style={{ marginTop: 4 }}>{section.skill} · {section.cefr} · {section.item_count} items · {section.section_score} pts</div>
              {section.passage_content ? <details style={{ marginTop: 8 }}><summary>Passage</summary><p>{section.passage_content}</p></details> : null}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Items" />
        <div className="card-body stack">
          {items.isLoading ? <LoadingState /> : items.error ? <ErrorState error={items.error} /> : items.data?.map((item) => <QuestionRenderer key={item.id} item={item} showAnswer />)}
        </div>
      </Card>
    </div>
  );
}
