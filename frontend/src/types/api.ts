export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | string;

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  current_node?: string | null;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  request?: Record<string, any> | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface QuestionItem {
  id: string;
  passage_id?: string | null;
  stem: string;
  question_type?: string | null;
  correct_answer?: string | null;
  options?: Record<string, any> | null;
  cefr_level?: string | null;
  difficulty?: number | null;
  judge_score?: number | null;
  status: string;
  revision_count: number;
  difficulty_band?: string | null;
  score_weight?: number | null;
  objective?: string | null;
  explanation?: string | null;
  tags?: string[] | null;
  paper_id?: string | null;
  section_name?: string | null;
  created_at?: string;
  passage_content?: string | null;
  skill?: string | null;
}

export interface Passage {
  id: string;
  content: string;
  word_count?: number | null;
  cefr_level?: string | null;
  topic?: string | null;
  skill?: string | null;
  created_at?: string;
  questions?: QuestionItem[];
}

export interface PaperSection {
  id: string;
  name: string;
  skill: string;
  cefr: string;
  topic?: string | null;
  item_count: number;
  section_score: number;
  section_time_min?: number | null;
  status: string;
  job_id?: string | null;
  error_message?: string | null;
  passage_id?: string | null;
  passage_content?: string | null;
  item_ids?: string[];
}

export interface Paper {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  total_score?: number | null;
  time_limit_min?: number | null;
  sections: PaperSection[];
  created_at?: string;
  completed_at?: string | null;
}

export interface PaperCreateRequest {
  name: string;
  description?: string | null;
  time_limit_min?: number | null;
  total_score: number;
  sections: Array<{
    name: string;
    skill: string;
    cefr: string;
    topic?: string | null;
    item_count: number;
    section_score: number;
    section_time_min?: number | null;
    question_types: string[];
    difficulty_mix?: { easy: number; medium: number; hard: number };
  }>;
}

export interface SessionStartResponse {
  session_id: string;
  paper_id: string;
  paper_name: string;
  time_limit_min?: number | null;
  items: QuestionItem[];
  started_at?: string;
}

export interface SessionResult {
  session_id: string;
  status: string;
  total_score?: number | null;
  max_score?: number | null;
  overall_cefr?: string | null;
  skill_cefr?: Record<string, string>;
  verdict?: string | null;
  breakdown?: Array<Record<string, any>>;
  submitted_at?: string | null;
  scored_at?: string | null;
}
