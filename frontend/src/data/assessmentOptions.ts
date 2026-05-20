export const CEFRS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export interface SkillDef {
  key: string;
  label: string;
  info: string;
}

export const SKILLS: SkillDef[] = [
  { key: "reading",    label: "Reading",    info: "Comprehend written passages; identify main idea, details, inferences." },
  { key: "grammar",    label: "Grammar",    info: "Apply grammatical rules: tense, agreement, articles, prepositions, word order." },
  { key: "vocabulary", label: "Vocabulary", info: "Know word meanings, synonyms, collocations, and usage in context." },
  { key: "writing",    label: "Writing",    info: "Produce written responses: emails, reports, opinion essays, structured paragraphs." },
  { key: "speaking",   label: "Speaking",   info: "Produce spoken responses: introductions, descriptions, opinions, problem-solving talks." },
  { key: "integrated", label: "Integrated", info: "Combine two or more skills, e.g. read-then-write or listen-then-speak." },
];

export interface QuestionTypeDef {
  key: string;
  label: string;
  info: string;
  skills: string[];
}

export const QUESTION_TYPE_DEFS: QuestionTypeDef[] = [
  { key: "multiple_choice",      label: "Multiple Choice",         info: "Pick one correct answer from four choices (A/B/C/D). Auto-gradable; widely used.",
    skills: ["reading","listening","grammar","vocabulary","integrated"] },
  { key: "true_false_not_given", label: "True / False / Not Given", info: "Judge a statement against the passage as True, False, or Not Given (no info).",
    skills: ["reading","listening","integrated"] },
  { key: "matching",             label: "Matching",                info: "Match items in column A to items in column B (e.g. words to definitions).",
    skills: ["reading","listening","vocabulary","integrated"] },
  { key: "fill_blank",           label: "Fill in the Blank",       info: "Choose the correct word/phrase to fill a blank in a sentence.",
    skills: ["reading","grammar","vocabulary","integrated"] },
  { key: "short_answer",         label: "Short Answer",            info: "Answer a wh-question in 1–10 words. Reduces guessing vs. MCQ.",
    skills: ["reading","listening","writing","integrated"] },
  { key: "essay",                label: "Essay",                   info: "Produce long-form writing (200–400 words) with structure, reasoning, register.",
    skills: ["writing","integrated"] },
  { key: "cloze",                label: "Cloze",                   info: "Choose the correct word to complete a blank in a short passage. Tests grammar + reading.",
    skills: ["reading","grammar","integrated"] },
  { key: "reordering",           label: "Reordering",              info: "Put scrambled sentences / dialogue lines into the correct order.",
    skills: ["reading","grammar","integrated"] },
  { key: "error_identification", label: "Error Identification",    info: "Identify the incorrect segment in a sentence and provide the correction.",
    skills: ["grammar","writing","integrated"] },
  { key: "main_idea",            label: "Main Idea",               info: "Identify what the passage is mainly about.",
    skills: ["reading","listening","integrated"] },
  { key: "detail",               label: "Detail",                  info: "Find a specific fact stated in the passage.",
    skills: ["reading","listening","integrated"] },
  { key: "inference",            label: "Inference",               info: "Determine what is implied but not directly stated.",
    skills: ["reading","listening","integrated"] },
  { key: "vocabulary_in_context",label: "Vocabulary in Context",   info: "Determine the meaning of a word as used in the passage.",
    skills: ["reading","vocabulary","integrated"] },
  { key: "tone_purpose",         label: "Tone & Purpose",          info: "Identify the author's purpose, tone, or attitude.",
    skills: ["reading","listening","integrated"] },
];

// Kept for backwards compatibility with PaperCreatePage
export const QUESTION_TYPES = QUESTION_TYPE_DEFS.map((q) => q.key);
export const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  QUESTION_TYPE_DEFS.map((q) => [q.key, q.label]),
);
