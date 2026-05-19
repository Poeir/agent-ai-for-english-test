import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { ErrorState, LoadingState } from "../components/ui/States";
import { cancelJob, listJobs } from "../services/jobsApi";
import { cancelPaper, listPapers } from "../services/papersApi";

function dateText(value?: string | null) {
  return value ? value.slice(0, 19).replace("T", " ") : "-";
}

export function JobsPage() {
  const queryClient = useQueryClient();
  const [jobStatus, setJobStatus] = useState("");
  const [paperStatus, setPaperStatus] = useState("");
  const paperParams = new URLSearchParams({ limit: "20" });
  const jobParams = new URLSearchParams({ limit: "50" });
  if (paperStatus) paperParams.set("status", paperStatus);
  if (jobStatus) jobParams.set("status", jobStatus);

  const papers = useQuery({ queryKey: ["papers", paperStatus], queryFn: () => listPapers(paperParams), refetchInterval: 3000 });
  const jobs = useQuery({ queryKey: ["jobs", jobStatus], queryFn: () => listJobs(jobParams), refetchInterval: 3000 });
  const cancelJobMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  const cancelPaperMutation = useMutation({
    mutationFn: cancelPaper,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["papers"] }),
  });

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Jobs & Monitoring</h1>
          <p className="page-subtitle">Track paper generation, section jobs, and running pipeline tasks.</p>
        </div>
      </header>
      <Card>
        <CardHeader title="Test Papers" actions={<select value={paperStatus} onChange={(e) => setPaperStatus(e.target.value)}><option value="">All</option><option>pending</option><option>running</option><option>completed</option><option>partial</option><option>failed</option><option>cancelled</option></select>} />
        <div className="table-wrap">
          {papers.isLoading ? <LoadingState /> : papers.error ? <ErrorState error={papers.error} /> : (
            <table className="table"><thead><tr><th>Name</th><th>Status</th><th>Sections</th><th>Created</th><th>Actions</th></tr></thead><tbody>
              {papers.data?.map((paper) => (
                <tr key={paper.id}>
                  <td>{paper.name}</td><td><Badge status={paper.status} /></td><td>{paper.sections.length}</td><td>{dateText(paper.created_at)}</td>
                  <td><Link className="btn" to={`/papers/${paper.id}`}>View</Link> {(paper.status === "pending" || paper.status === "running") ? <Button onClick={() => cancelPaperMutation.mutate(paper.id)}>Cancel</Button> : null}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Generation Jobs" actions={<select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}><option value="">All</option><option>pending</option><option>running</option><option>completed</option><option>failed</option><option>cancelled</option></select>} />
        <div className="table-wrap">
          {jobs.isLoading ? <LoadingState /> : jobs.error ? <ErrorState error={jobs.error} /> : (
            <table className="table"><thead><tr><th>Job</th><th>Status</th><th>Current</th><th>Created</th><th>Actions</th></tr></thead><tbody>
              {jobs.data?.map((job) => (
                <tr key={job.job_id}>
                  <td className="mono">{job.job_id.slice(0, 8)}...</td><td><Badge status={job.status} /></td><td>{job.current_node || "-"}</td><td>{dateText(job.created_at)}</td>
                  <td><Link className="btn" to={`/jobs/${job.job_id}`}>View</Link> {(job.status === "pending" || job.status === "running") ? <Button onClick={() => cancelJobMutation.mutate(job.job_id)}>Cancel</Button> : null}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </Card>
    </div>
  );
}
