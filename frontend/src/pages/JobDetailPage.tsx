import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { PipelineView } from "../components/domain/PipelineView";
import { cancelJob, getJob } from "../services/jobsApi";

function dateText(value?: string | null) {
  return value ? value.slice(0, 19).replace("T", " ") : "—";
}

export function JobDetailPage() {
  const { jobId = "" } = useParams();
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1000 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
  });

  if (jobQuery.isLoading) return <LoadingState />;
  if (jobQuery.error) return <ErrorState error={jobQuery.error} />;
  if (!jobQuery.data) return null;

  const job = jobQuery.data;
  const requirement = (job.request?.requirement as string) || "";
  const isLive = job.status === "pending" || job.status === "running";

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Job Detail</h1>
          <p className="page-subtitle mono" style={{ fontSize: 12 }}>{jobId}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Badge status={job.status} />
          {isLive ? (
            <Button onClick={() => cancelMutation.mutate(jobId)} disabled={cancelMutation.isPending}>
              Cancel
            </Button>
          ) : null}
          <Link className="btn" to="/jobs">← Back to Jobs</Link>
        </div>
      </header>

      <Card>
        <CardHeader title="Summary" description="Job metadata and the original request." />
        <div className="card-body stack">
          <div className="grid-3">
            <Meta label="Status" value={<Badge status={job.status} />} />
            <Meta label="Current node" value={job.current_node || "—"} />
            <Meta label="Item count" value={String((job.request as any)?.item_count ?? "—")} />
            <Meta label="Created" value={dateText(job.created_at)} />
            <Meta label="Started" value={dateText(job.started_at)} />
            <Meta label="Completed" value={dateText(job.completed_at)} />
          </div>
          {job.error_message ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 10, color: "#991b1b", fontSize: 13 }}>
              <strong>Error:</strong> {job.error_message}
            </div>
          ) : null}
          <div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
              Requirement
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, padding: 10, background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 6 }}>
              {requirement || <span className="muted">(empty)</span>}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Pipeline"
          description="LangGraph node-by-node trace of this job."
          actions={<Badge status={job.status} />}
        />
        <div className="card-body stack">
          <PipelineView job={job} requirement={requirement} />
        </div>
      </Card>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="question-card">
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 14 }}>{value}</div>
    </div>
  );
}
