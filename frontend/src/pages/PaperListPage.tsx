import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { listPapers } from "../services/papersApi";

export function PaperListPage() {
  const query = useQuery({ queryKey: ["papers"], queryFn: () => listPapers(new URLSearchParams({ limit: "50" })) });
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Papers</h1>
          <p className="page-subtitle">Review generated paper tests and open detailed item lists.</p>
        </div>
        <Link className="btn primary" to="/papers/new">Create paper</Link>
      </header>
      <Card>
        <CardHeader title="All Papers" />
        {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} /> : (
          <div className="table-wrap">
            <table className="table"><thead><tr><th>Name</th><th>Status</th><th>Sections</th><th>Score</th><th>Actions</th></tr></thead><tbody>
              {query.data?.map((paper) => (
                <tr key={paper.id}>
                  <td>{paper.name}</td><td><Badge status={paper.status} /></td><td>{paper.sections.length}</td><td>{paper.total_score || "-"}</td>
                  <td><Link className="btn" to={`/papers/${paper.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </Card>
    </div>
  );
}
