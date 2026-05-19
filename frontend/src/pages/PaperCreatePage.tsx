import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { ErrorState } from "../components/ui/States";
import { CEFRS, QUESTION_TYPES, SKILLS } from "../data/assessmentOptions";
import { createPaper } from "../services/papersApi";
import type { PaperCreateRequest } from "../types/api";

type SectionDraft = PaperCreateRequest["sections"][number];

const defaultSection = (index: number): SectionDraft => ({
  name: `Section ${index}`,
  skill: "grammar",
  cefr: "B1",
  topic: null,
  item_count: 5,
  section_score: 10,
  section_time_min: null,
  question_types: ["multiple_choice"],
  difficulty_mix: { easy: 0.4, medium: 0.4, hard: 0.2 },
});

export function PaperCreatePage() {
  const [name, setName] = useState("English Competency Test");
  const [description, setDescription] = useState("");
  const [timeLimit, setTimeLimit] = useState(60);
  const [sections, setSections] = useState<SectionDraft[]>([defaultSection(1)]);
  const mutation = useMutation({ mutationFn: createPaper });

  const updateSection = (index: number, patch: Partial<SectionDraft>) => {
    setSections((current) => current.map((section, idx) => idx === index ? { ...section, ...patch } : section));
  };

  const totalScore = sections.reduce((sum, section) => sum + Number(section.section_score || 0), 0);

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Paper Test</h1>
          <p className="page-subtitle">Create a structured test paper with multiple sections and background generation jobs.</p>
        </div>
        <Link className="btn" to="/papers">View papers</Link>
      </header>
      <Card>
        <CardHeader title="Paper Details" />
        <div className="card-body stack">
          <div className="grid-3">
            <Field label="Paper name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Time limit (min)"><input type="number" value={timeLimit} onChange={(event) => setTimeLimit(Number(event.target.value) || 0)} /></Field>
            <Field label="Total score"><input value={totalScore} readOnly /></Field>
          </div>
          <Field label="Description"><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Sections"
          actions={<Button onClick={() => setSections((current) => [...current, defaultSection(current.length + 1)])}>Add section</Button>}
        />
        <div className="card-body stack">
          {sections.map((section, index) => (
            <div className="question-card stack" key={index}>
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <strong>{section.name}</strong>
                <Button onClick={() => setSections((current) => current.filter((_, idx) => idx !== index))} disabled={sections.length === 1}>Remove</Button>
              </div>
              <div className="grid-3">
                <Field label="Name"><input value={section.name} onChange={(event) => updateSection(index, { name: event.target.value })} /></Field>
                <Field label="Skill"><select value={section.skill} onChange={(event) => updateSection(index, { skill: event.target.value })}>{SKILLS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field>
                <Field label="CEFR"><select value={section.cefr} onChange={(event) => updateSection(index, { cefr: event.target.value })}>{CEFRS.map((item) => <option key={item}>{item}</option>)}</select></Field>
              </div>
              <div className="grid-3">
                <Field label="Items"><input type="number" value={section.item_count} onChange={(event) => updateSection(index, { item_count: Number(event.target.value) || 1 })} /></Field>
                <Field label="Score"><input type="number" value={section.section_score} onChange={(event) => updateSection(index, { section_score: Number(event.target.value) || 1 })} /></Field>
                <Field label="Time (min)"><input type="number" value={section.section_time_min || ""} onChange={(event) => updateSection(index, { section_time_min: Number(event.target.value) || null })} /></Field>
              </div>
              <Field label="Question types">
                <div className="segmented">
                  {QUESTION_TYPES.map((type) => (
                    <button
                      type="button"
                      key={type}
                      className={`chip ${section.question_types.includes(type) ? "active" : ""}`}
                      onClick={() => updateSection(index, {
                        question_types: section.question_types.includes(type)
                          ? section.question_types.filter((item) => item !== type)
                          : [...section.question_types, type],
                      })}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ))}
          <Button
            variant="primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ name, description: description || null, time_limit_min: timeLimit || null, total_score: totalScore, sections })}
          >
            {mutation.isPending ? "Creating..." : "Create paper"}
          </Button>
          {mutation.error ? <ErrorState error={mutation.error} /> : null}
          {mutation.data ? <div className="card-body"><Link className="btn primary" to={`/papers/${mutation.data.id}`}>Open created paper</Link></div> : null}
        </div>
      </Card>
    </div>
  );
}
