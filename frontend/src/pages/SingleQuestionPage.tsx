import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { QUESTION_TYPE_DEFS, SKILLS, CEFRS } from "../data/assessmentOptions";
import { createGenerationJob, getJob } from "../services/jobsApi";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { ErrorState } from "../components/ui/States";
import { PipelineView } from "../components/domain/PipelineView";

export function SingleQuestionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialJobId = searchParams.get("job") || "";
  const [jobId, setJobId] = useState(initialJobId);
  const [requirement, setRequirement] = useState("");
  const [skill, setSkill] = useState("");
  const [cefr, setCefr] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [itemCount, setItemCount] = useState(3);
  const [types, setTypes] = useState<string[]>([]);
  const [showSkillInfo, setShowSkillInfo] = useState(false);
  const [showTypeInfo, setShowTypeInfo] = useState(false);

  const visibleTypes = skill
    ? QUESTION_TYPE_DEFS.filter((q) => q.skills.includes(skill))
    : QUESTION_TYPE_DEFS;

  function toggleType(key: string) {
    setTypes((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  }

  function selectSkill(next: string) {
    const newSkill = skill === next ? "" : next;
    setSkill(newSkill);
    // Drop types that are no longer compatible with the new skill
    if (newSkill) {
      const allowed = new Set(QUESTION_TYPE_DEFS.filter((q) => q.skills.includes(newSkill)).map((q) => q.key));
      setTypes((current) => current.filter((k) => allowed.has(k)));
    }
  }

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1000 : false;
    },
  });

  const createJob = useMutation({
    mutationFn: createGenerationJob,
    onSuccess: (job) => {
      setJobId(job.job_id);
      setSearchParams({ job: job.job_id });
    },
  });

  const composedRequirement = useMemo(() => {
    const constraints = [
      skill ? `skill = ${skill}` : "",
      cefr ? `CEFR level = ${cefr}` : "",
      difficulty ? `difficulty = ${difficulty}` : "",
      types.length ? `question_types = [${types.join(", ")}]` : "",
      `item_count = ${itemCount}`,
    ].filter(Boolean);
    return [requirement.trim(), `Constraints: ${constraints.join("; ")}.`].filter(Boolean).join("\n\n");
  }, [cefr, difficulty, itemCount, requirement, skill, types]);

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Quick Generate</h1>
          <p className="page-subtitle">Generate a focused set of CEFR-aligned English test items and inspect the pipeline in real time.</p>
        </div>
      </header>

      <Card>
        <CardHeader title="Generation Request" description="Set the target skill and item constraints before running the agent pipeline." />
        <div className="card-body stack">
          <Field label="Requirement">
            <textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="Generate questions about workplace communication." />
          </Field>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 650, color: "#475569" }}>Skill</label>
              <button type="button" className="info-ic" aria-label="Skill info" onClick={() => setShowSkillInfo((v) => !v)}>i</button>
            </div>
            {showSkillInfo ? (
              <div className="info-panel" style={{ marginBottom: 8 }}>
                <dl>
                  {SKILLS.map((s) => (
                    <FragmentRow key={s.key} label={s.label} info={s.info} />
                  ))}
                </dl>
              </div>
            ) : null}
            <div className="segmented">
              {SKILLS.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  className={`skill-pill ${skill === s.key ? "selected" : ""}`}
                  onClick={() => selectSkill(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid-3">
            <Field label="CEFR">
              <select value={cefr} onChange={(event) => setCefr(event.target.value)}>
                <option value="">Auto</option>
                {CEFRS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Difficulty">
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                <option value="">Auto</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </Field>
            <Field label="Item count">
              <input type="number" min={1} max={20} value={itemCount} onChange={(event) => setItemCount(Number(event.target.value) || 1)} />
            </Field>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 650, color: "#475569" }}>
                  Question Types <span className="muted" style={{ fontWeight: 400 }}>(choose one or more)</span>
                </label>
                <button type="button" className="info-ic" aria-label="Question type info" onClick={() => setShowTypeInfo((v) => !v)}>i</button>
              </div>
              {types.length ? (
                <button type="button" className="btn" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setTypes([])}>Clear all</button>
              ) : null}
            </div>
            {showTypeInfo ? (
              <div className="info-panel" style={{ marginBottom: 8 }}>
                <dl>
                  {QUESTION_TYPE_DEFS.map((q) => (
                    <FragmentRow key={q.key} label={q.label} info={q.info} />
                  ))}
                </dl>
              </div>
            ) : null}
            <div className="qtype-grid">
              {visibleTypes.map((q) => {
                const selected = types.includes(q.key);
                return (
                  <label key={q.key} className={`qtype-card ${selected ? "selected" : ""}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleType(q.key)} />
                    <span className="qtype-label">{q.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              {skill
                ? `Showing question types compatible with "${skill}".`
                : "Pick a skill to filter compatible question types, or leave it blank."}
            </div>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <Button
              variant="primary"
              disabled={createJob.isPending || (!requirement.trim() && !skill && !types.length)}
              onClick={() => createJob.mutate({ requirement: composedRequirement, item_count: itemCount })}
            >
              {createJob.isPending ? "Running..." : "Run pipeline"}
            </Button>
          </div>
          {createJob.error ? <ErrorState error={createJob.error} /> : null}
        </div>
      </Card>

      {jobId ? (
        <Card>
          <CardHeader
            title="Pipeline Status"
            description={jobId}
            actions={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {jobQuery.data ? <Badge status={jobQuery.data.status} /> : null}
                <Link className="btn" to={`/jobs/${jobId}`}>Open job detail →</Link>
              </div>
            }
          />
          <div className="card-body stack">
            {jobQuery.error ? <ErrorState error={jobQuery.error} /> : null}
            <PipelineView job={jobQuery.data} requirement={composedRequirement} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function FragmentRow({ label, info }: { label: string; info: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{info}</dd>
    </>
  );
}
