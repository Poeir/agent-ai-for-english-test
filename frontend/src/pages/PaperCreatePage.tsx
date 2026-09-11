import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardHeader } from "../components/ui/Card";
import { Field } from "../components/ui/Field";
import { ErrorState } from "../components/ui/States";
import { CEFRS, QUESTION_TYPE_DEFS, SKILLS, TYPE_LABELS } from "../data/assessmentOptions";
import { createPaper } from "../services/papersApi";
import type { PaperCreateRequest } from "../types/api";
import { estimateTokens, formatTokens, formatUSD, formatTHB } from "../utils/tokenEstimate";

type SectionDraft = PaperCreateRequest["sections"][number];

const SOURCE_TEXT_SKILLS = new Set(["reading", "listening", "conversation", "integrated"]);

const PASSAGE_LENGTH_OPTIONS = [
  { value: "", label: "Default source length" },
  { value: "120-160 words", label: "Short passage (120-160 words)" },
  { value: "250-350 words", label: "Medium article (250-350 words)" },
  { value: "700-900 words", label: "Long article (700-900 words)" },
  { value: "1000-1200 words", label: "Extended article (1000-1200 words)" },
];

const defaultSection = (index: number): SectionDraft => ({
  name: `Section ${index}`,
  skill: "grammar",
  cefr: "B1",
  topic: null,
  passage_length: null,
  item_count: 5,
  section_score: 10,
  section_time_min: null,
  question_types: ["multiple_choice"],
  difficulty_mix: { easy: 0.4, medium: 0.4, hard: 0.2 },
});

interface PaperTemplate {
  key: string;
  label: string;
  description: string;
  paperName: string;
  paperDescription?: string;
  timeLimit: number;
  sections: SectionDraft[];
}

const PAPER_TEMPLATES: PaperTemplate[] = [
  {
    key: "blank",
    label: "Blank",
    description: "Start from a single empty section.",
    paperName: "English Competency Test",
    paperDescription: "",
    timeLimit: 60,
    sections: [defaultSection(1)],
  },
  {
    key: "quick_placement_15",
    label: "Quick Placement (15 min, 3-Band)",
    description:
      "15 min / 20 items, fully auto-gradable. Ladder design at A2 → B1 → C1 only (B2 skipped — same band as B1). Result maps to 3 bands: ≤A2 Beginner, B1–B2 Intermediate, C1+ Advanced. 4 items per level so passing needs 3/4 (75% ≥ 0.7 mastery threshold).",
    paperName: "Quick Placement Test (15 min)",
    paperDescription:
      "Compact 3-band placement test (Beginner / Intermediate / Advanced). Grammar is sampled at A2, B1, and C1; reading at B1 and C1. All items are objective MCQ so results are available immediately after submission. Band mapping: below A1–A2 = Beginner, B1–B2 = Intermediate, C1–C2 = Advanced.",
    timeLimit: 15,
    sections: (() => {
      const GRAMMAR_BASE =
        "Practical everyday and workplace grammar from emails, messages, and conversations: tense, modals, articles, prepositions, agreement, and natural phrasing.";
      const READ_BASE =
        "Short everyday or workplace text — an email, notice, memo, chat thread, or announcement — with comprehension questions.";

      // Each rung of the ladder must clearly separate the band below it from the
      // band above it, so the stretch hints pin difficulty hard to the level.
      const STRETCH: Record<string, string> = {
        A2: "Keep strictly at A2: high-frequency vocabulary, simple tenses, basic prepositions and articles, short direct sentences. A beginner below A2 should get these wrong; any B1 candidate should find them easy.",
        B1: "Target solid B1: common workplace vocabulary, present perfect vs past simple, modal choice, multi-clause sentences. An A2 candidate should struggle; a B2 candidate should find them comfortable.",
        C1: "Target C1: nuanced register, idiomatic expressions, complex structure, implied meaning, polite hedging. A B1-B2 candidate should find these genuinely difficult. Sophistication should come from register and implication, not rare academic lexicon.",
      };

      const MIX: Record<string, { easy: number; medium: number; hard: number }> = {
        A2: { easy: 0.5, medium: 0.4, hard: 0.1 },
        B1: { easy: 0.3, medium: 0.5, hard: 0.2 },
        C1: { easy: 0.15, medium: 0.5, hard: 0.35 },
      };

      const out: SectionDraft[] = [];

      // Grammar ladder × 3 levels (12 items, ~8 min)
      for (const lvl of ["A2", "B1", "C1"]) {
        out.push({
          name: `Grammar ${lvl}`,
          skill: "grammar",
          cefr: lvl,
          topic: `${GRAMMAR_BASE} ${STRETCH[lvl]}`,
          passage_length: "none",
          item_count: 4,
          section_score: 4,
          section_time_min: lvl === "A2" ? 2 : 3,
          question_types:
            lvl === "A2"
              ? ["multiple_choice", "fill_blank"]
              : ["multiple_choice", "fill_blank", "error_identification"],
          difficulty_mix: MIX[lvl],
        });
      }

      // Reading ladder × 2 levels (8 items, ~7 min). No A2 reading section —
      // the classifier only gates on levels present, so reading ladders B1 → C1.
      const READING_LEN: Record<string, string> = { B1: "100-140 words", C1: "150-200 words" };
      for (const lvl of ["B1", "C1"]) {
        out.push({
          name: `Reading ${lvl}`,
          skill: "reading",
          cefr: lvl,
          topic: `${READ_BASE} ${STRETCH[lvl]}`,
          passage_length: READING_LEN[lvl],
          item_count: 4,
          section_score: 4,
          section_time_min: lvl === "B1" ? 3 : 4,
          question_types:
            lvl === "B1"
              ? ["main_idea", "detail", "vocabulary_in_context"]
              : ["inference", "detail", "tone_purpose"],
          difficulty_mix: MIX[lvl],
        });
      }

      return out;
    })(),
  },
  {
    key: "english_competency_30",
    label: "English Competency Test (30)",
    description: "30 questions / 30 min: ECT-style Listening (15) + Vocabulary, Grammar, and Reading (15). Shared situations are capped at 4 questions.",
    paperName: "English Competency Test (30 Questions)",
    paperDescription: "Compact English Competency Test format with workplace listening, vocabulary, grammar, and reading. Source-based situations use no more than four questions per transcript, email, notice, article, or report.",
    timeLimit: 30,
    sections: [
      {
        name: "Section 1 - Listening: Photographs",
        skill: "listening",
        cefr: "B1",
        topic: "TOEIC-style workplace and daily-life photographs. Each item is a separate self-contained photo description question with realistic office, service, travel, or customer-facing scenes.",
        passage_length: "none",
        item_count: 3,
        section_score: 3,
        section_time_min: 3,
        question_types: ["photo_description"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Section 1 - Listening: Question-Response",
        skill: "listening",
        cefr: "B1",
        topic: "Workplace question-response items: scheduling, requests, clarification, directions, meeting rooms, customer service, and polite follow-up. Each item is independent.",
        passage_length: "none",
        item_count: 5,
        section_score: 5,
        section_time_min: 5,
        question_types: ["question_response"],
        difficulty_mix: { easy: 0.35, medium: 0.5, hard: 0.15 },
      },
      {
        name: "Section 1 - Listening: Conversation A",
        skill: "listening",
        cefr: "B1",
        topic: "One short workplace dialogue between two speakers about a meeting, deadline, or office coordination issue. Ask only 2 questions about purpose, problem, implied meaning, or next action.",
        passage_length: "70-100 words",
        item_count: 2,
        section_score: 2,
        section_time_min: 3,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Section 1 - Listening: Conversation B",
        skill: "listening",
        cefr: "B2",
        topic: "One short workplace dialogue between two or three speakers about a delivery issue, service problem, travel change, or scheduling conflict. Ask only 2 situation-based questions.",
        passage_length: "90-120 words",
        item_count: 2,
        section_score: 2,
        section_time_min: 3,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.55, hard: 0.25 },
      },
      {
        name: "Section 1 - Listening: Short Talk",
        skill: "listening",
        cefr: "B2",
        topic: "One single-speaker workplace short talk: announcement, voicemail, briefing, travel notice, or company update. Ask exactly 3 questions and keep the source situation under the 4-question limit.",
        passage_length: "100-140 words",
        item_count: 3,
        section_score: 3,
        section_time_min: 4,
        question_types: ["main_idea", "detail", "inference", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.55, hard: 0.25 },
      },
      {
        name: "Section 2 - Language Use: Vocabulary",
        skill: "vocabulary",
        cefr: "B2",
        topic: "Workplace vocabulary, collocations, and meaning from context. Use business sentences about meetings, project updates, customer service, reports, and operations.",
        passage_length: "none",
        item_count: 4,
        section_score: 4,
        section_time_min: 4,
        question_types: ["fill_blank", "multiple_choice", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
      },
      {
        name: "Section 2 - Language Use: Grammar",
        skill: "grammar",
        cefr: "B2",
        topic: "Practical workplace grammar in emails, reports, meetings, and customer messages: tense, modals, conditionals, articles, prepositions, agreement, and sentence structure.",
        passage_length: "none",
        item_count: 4,
        section_score: 4,
        section_time_min: 4,
        question_types: ["fill_blank", "multiple_choice", "error_identification"],
        difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
      },
      {
        name: "Section 2 - Reading: Short Workplace Text",
        skill: "reading",
        cefr: "B2",
        topic: "One short workplace email, notice, chat, or memo. Ask exactly 3 questions about purpose, implication, tone, inference, or next action.",
        passage_length: "120-160 words",
        item_count: 3,
        section_score: 3,
        section_time_min: 6,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.55, hard: 0.25 },
      },
      {
        name: "Section 2 - Reading: Article or Report",
        skill: "reading",
        cefr: "C1",
        topic: "One workplace article, report, policy update, or business scenario with denser reasoning. Ask exactly 4 questions and do not exceed 4 questions for this source text. Cover purpose, key detail, inference, implication, tone, or vocabulary in context.",
        passage_length: "250-350 words",
        item_count: 4,
        section_score: 4,
        section_time_min: 8,
        question_types: ["main_idea", "detail", "inference", "implication", "tone_purpose", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.15, medium: 0.5, hard: 0.35 },
      },
    ],
  },
  {
    key: "english_competency_50",
    label: "English Competency Test (50)",
    description: "50 questions / 50 min: workplace Listening (25) + Reading, Vocabulary, Grammar (25). Mixed B1-C1 difficulty, auto-gradable.",
    paperName: "English Competency Test",
    paperDescription: "Workplace-focused English competency test with Listening Comprehension and Reading Comprehension sections. 50 questions, 50 minutes. Difficulty progresses from B1 foundation through B2 workplace competence to C1 stretch items.",
    timeLimit: 50,
    sections: [
      {
        name: "Section 1 - Listening: Part 1 Photographs",
        skill: "listening",
        cefr: "B1",
        topic: "TOEIC-style workplace photographs. Measure basic vocabulary, workplace observation, and present continuous action description. Images should show realistic office, service, meeting, reception, warehouse, commute, or customer-service scenes. Options should be short sentences like 'A woman is speaking on the phone' or 'The employees are attending a meeting.'",
        passage_length: "none",
        item_count: 5,
        section_score: 5,
        section_time_min: 3,
        question_types: ["photo_description"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Section 1 - Listening: Part 2 Question-Response",
        skill: "listening",
        cefr: "B1",
        topic: "Workplace question-response items. Focus on real conversation reactions, workplace communication, and functional English: requests, scheduling, clarification, customer service, office communication, parking, reports, deadlines, meeting rooms, and polite follow-up.",
        passage_length: "none",
        item_count: 8,
        section_score: 8,
        section_time_min: 5,
        question_types: ["question_response"],
        difficulty_mix: { easy: 0.3, medium: 0.55, hard: 0.15 },
      },
      {
        name: "Section 1 - Listening: Part 3 Conversation A",
        skill: "listening",
        cefr: "B1",
        topic: "Dialogue between two or three workplace speakers about a meeting or office coordination issue. Ask situation-based questions: speaker purpose, the main problem, the best response, and the likely next action. Avoid simple literal-detail recall.",
        passage_length: "80-110 words",
        item_count: 2,
        section_score: 2,
        section_time_min: 3,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
      },
      {
        name: "Section 1 - Listening: Part 3 Conversation B",
        skill: "listening",
        cefr: "B2",
        topic: "Dialogue between two or three speakers about a delivery issue, scheduling conflict, customer complaint, or service problem. Questions should test the problem, speaker intention, suitable response, and next action rather than only who said what.",
        passage_length: "90-120 words",
        item_count: 2,
        section_score: 2,
        section_time_min: 3,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.55, hard: 0.25 },
      },
      {
        name: "Section 1 - Listening: Part 3 Conversation C",
        skill: "listening",
        cefr: "C1",
        topic: "Dialogue between two or three speakers about customer service, office coordination, rescheduling, or handling a complaint. Use natural workplace turn-taking with more indirect meaning and nuanced intent. Ask about purpose, problem, implied meaning, suitable response, and next action.",
        passage_length: "120-150 words",
        item_count: 3,
        section_score: 3,
        section_time_min: 3,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.15, medium: 0.5, hard: 0.35 },
      },
      {
        name: "Section 1 - Listening: Part 4 Short Talk A",
        skill: "listening",
        cefr: "B2",
        topic: "Single-speaker short talk: company announcement, HR orientation, voicemail, or briefing. Measure gist, important details, and instruction understanding.",
        passage_length: "100-130 words",
        item_count: 2,
        section_score: 2,
        section_time_min: 4,
        question_types: ["main_idea", "detail", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.55, hard: 0.25 },
      },
      {
        name: "Section 1 - Listening: Part 4 Short Talk B",
        skill: "listening",
        cefr: "C1",
        topic: "Single-speaker short talk: train or airport announcement, sales update, company announcement, voicemail, or short presentation. Include denser information, implied priorities, and nuanced speaker purpose. Measure gist, key details, instruction understanding, and likely next action.",
        passage_length: "130-170 words",
        item_count: 3,
        section_score: 3,
        section_time_min: 4,
        question_types: ["main_idea", "detail", "inference", "tone_purpose"],
        difficulty_mix: { easy: 0.15, medium: 0.5, hard: 0.35 },
      },
      {
        name: "Section 2 - Reading: Part 5 Vocabulary",
        skill: "vocabulary",
        cefr: "B2",
        topic: "Context vocabulary, not isolated memorization. Use workplace sentences and business collocations from B1-B2+ contexts. Measure workplace vocabulary, collocation, tone appropriateness, and meaning from context. Include some harder items with near-synonyms or register choices. Example style: 'The manager tried to ______ employee morale.'",
        passage_length: "none",
        item_count: 8,
        section_score: 8,
        section_time_min: 5,
        question_types: ["fill_blank", "multiple_choice", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
      },
      {
        name: "Section 2 - Reading: Part 6 Grammar",
        skill: "grammar",
        cefr: "B2",
        topic: "Practical workplace grammar used in emails, reports, meetings, and customer messages. Cover tense, modal verbs, conditionals, subject-verb agreement, sentence structure, articles, and prepositions. Mix B1 foundations with B2+ items that require choosing the most natural workplace phrasing. Avoid overly academic grammar.",
        passage_length: "none",
        item_count: 7,
        section_score: 7,
        section_time_min: 5,
        question_types: ["fill_blank", "multiple_choice", "error_identification"],
        difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
      },
      {
        name: "Section 2 - Reading: Part 7 Short Reading",
        skill: "reading",
        cefr: "B2",
        topic: "Short workplace reading: email, notice, chat, or memo. Ask about purpose, implication, tone, inference, and next action. Do not rely only on literal detail questions.",
        passage_length: "120-160 words",
        item_count: 4,
        section_score: 4,
        section_time_min: 6,
        question_types: ["main_idea", "inference", "implication", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.55, hard: 0.25 },
      },
      {
        name: "Section 2 - Reading: Part 7 Long Reading",
        skill: "reading",
        cefr: "C1",
        topic: "Longer workplace reading: article, report, or workplace scenario with denser reasoning, implied recommendations, and nuanced tone. Ask about purpose, implication, tone, inference, key supporting details, and next action. Keep literal-detail questions limited and meaningful.",
        passage_length: "300-400 words",
        item_count: 6,
        section_score: 6,
        section_time_min: 9,
        question_types: ["main_idea", "detail", "inference", "implication", "tone_purpose", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.15, medium: 0.5, hard: 0.35 },
      },
    ],
  },
  {
    key: "workplace_quick_20",
    label: "Workplace Quick (20 min)",
    description: "20 min / 16 items, reading-only, B1-C2. Each skill (Vocab, Conversation, Grammar, Short Reading) is sampled at all 4 CEFR levels so the classifier can place candidates from B1 through C2.",
    paperName: "Workplace English Quick Assessment (20 min)",
    paperDescription: "Compact 20-minute reading-only test for working professionals. Vocabulary, functional conversation, business grammar, and short workplace reading — each sampled at B1, B2, C1, and C2 so the CEFR classifier can discriminate across the full B1-C2 range. No listening required.",
    timeLimit: 20,
    sections: (() => {
      const VOCAB_BASE = "Workplace vocabulary in context: business collocations, polite register, and meaning from context. Use realistic office sentences about meetings, emails, deadlines, project updates, customer service, and reports.";
      const GRAMMAR_BASE = "Practical workplace grammar from emails, reports, meeting notes, and customer messages: tense, modals, conditionals, articles, prepositions, subject-verb agreement, and natural workplace phrasing.";
      const CONV_BASE = "Functional workplace conversation: 2-3 line dialogues with one missing turn — polite requests, scheduling, clarification, customer service, meetings, small talk with colleagues or clients.";
      const READ_BASE = "Short workplace text — an email, memo, notice, chat thread, or internal announcement — with one comprehension item per passage.";

      // Per-CEFR difficulty bias (easy/medium/hard within that level)
      const MIX: Record<string, { easy: number; medium: number; hard: number }> = {
        B1: { easy: 0.4, medium: 0.5, hard: 0.1 },
        B2: { easy: 0.25, medium: 0.55, hard: 0.2 },
        C1: { easy: 0.15, medium: 0.5, hard: 0.35 },
        C2: { easy: 0.1, medium: 0.4, hard: 0.5 },
      };

      // Per-CEFR stretch hints appended to each topic.
      // C2 is deliberately framed as WORKPLACE diplomacy/register — NOT as rare/SAT
      // vocabulary. A C2 business communicator hedges, manages tone, and reads
      // between the lines; they do not use words like "placate" or "obfuscate".
      const STRETCH: Record<string, string> = {
        B1: "Keep vocabulary and structures at the B1 foundation level: common workplace nouns/verbs, simple tenses, direct phrasing. For grammar items, test MEANINGFUL choices (tense fit, modal choice, preposition collocation) — do NOT test obvious typo-style errors like 'must be submit'.",
        B2: "Target solid B2: less common business vocabulary, multi-clause sentences, modal nuance, mild indirectness. Distractors should be defensible misreadings, not obviously wrong.",
        C1: "Target C1 workplace English: nuanced register, idiomatic business expressions, complex sentence structure, implied meaning, polite hedging. Test diplomatic phrasing and implication — not academic vocabulary.",
        C2: "Target C2 WORKPLACE English: diplomatic hedging, strategic tone, executive register, subtle disagreement, reading between the lines, indirect refusal, face-saving language. DO NOT use academic/SAT/GRE vocabulary (no 'placate', 'obfuscate', 'prevaricate', 'circumlocution'). Words must sound natural in a real corporate email or boardroom — sophistication should come from REGISTER and IMPLICATION, not rare lexicon.",
      };

      const READING_LEN: Record<string, string> = {
        B1: "80-110 words",
        B2: "110-140 words",
        C1: "150-200 words",
        C2: "200-260 words",
      };

      const LEVELS = ["B1", "B2", "C1", "C2"] as const;
      const out: SectionDraft[] = [];

      // Vocabulary × 4 levels (4 items, 4 min total — ~1 min per item)
      for (const lvl of LEVELS) {
        out.push({
          name: `Vocabulary ${lvl}`,
          skill: "vocabulary",
          cefr: lvl,
          topic: `${VOCAB_BASE} ${STRETCH[lvl]}`,
          passage_length: "none",
          item_count: 1,
          section_score: 1,
          section_time_min: 1,
          question_types: ["fill_blank", "multiple_choice", "vocabulary_in_context"],
          difficulty_mix: MIX[lvl],
        });
      }

      // Grammar × 4 levels (4 items, 4 min)
      for (const lvl of LEVELS) {
        out.push({
          name: `Grammar ${lvl}`,
          skill: "grammar",
          cefr: lvl,
          topic: `${GRAMMAR_BASE} ${STRETCH[lvl]}`,
          passage_length: "none",
          item_count: 1,
          section_score: 1,
          section_time_min: 1,
          question_types: ["fill_blank", "multiple_choice", "error_identification"],
          difficulty_mix: MIX[lvl],
        });
      }

      // Conversation × 4 levels (4 items, 4 min)
      for (const lvl of LEVELS) {
        out.push({
          name: `Conversation ${lvl}`,
          skill: "integrated",
          cefr: lvl,
          topic: `${CONV_BASE} ${STRETCH[lvl]}`,
          passage_length: "none",
          item_count: 1,
          section_score: 1,
          section_time_min: 1,
          question_types: ["multiple_choice"],
          difficulty_mix: MIX[lvl],
        });
      }

      // Short Reading × 4 levels (4 items, 8 min — passage + question per level)
      for (const lvl of LEVELS) {
        out.push({
          name: `Short Reading ${lvl}`,
          skill: "reading",
          cefr: lvl,
          topic: `${READ_BASE} ${STRETCH[lvl]}`,
          passage_length: READING_LEN[lvl],
          item_count: 1,
          section_score: 1,
          section_time_min: 2,
          question_types: ["main_idea", "inference", "implication", "tone_purpose"],
          difficulty_mix: MIX[lvl],
        });
      }

      return out;
    })(),
  },
  {
    key: "b1_competency",
    label: "B1 Competency Test",
    description: "Grammar + Reading + Listening + Writing at B1 (~55 min, 80 pts).",
    paperName: "English Competency Test (B1)",
    paperDescription: "Balanced B1 paper across grammar, reading, listening, and writing.",
    timeLimit: 60,
    sections: [
      {
        name: "Grammar & Vocabulary",
        skill: "grammar",
        cefr: "B1",
        topic: null,
        item_count: 10,
        section_score: 25,
        section_time_min: 15,
        question_types: ["multiple_choice", "fill_blank", "error_identification"],
        difficulty_mix: { easy: 0.4, medium: 0.4, hard: 0.2 },
      },
      {
        name: "Reading",
        skill: "reading",
        cefr: "B1",
        topic: "workplace communication",
        item_count: 8,
        section_score: 20,
        section_time_min: 15,
        question_types: ["main_idea", "detail", "inference"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Listening",
        skill: "listening",
        cefr: "B1",
        topic: "office dialogue",
        item_count: 6,
        section_score: 15,
        section_time_min: 10,
        question_types: ["main_idea", "detail"],
        difficulty_mix: { easy: 0.4, medium: 0.4, hard: 0.2 },
      },
      {
        name: "Writing",
        skill: "writing",
        cefr: "B1",
        topic: null,
        item_count: 1,
        section_score: 20,
        section_time_min: 15,
        question_types: ["essay"],
        difficulty_mix: { easy: 0.4, medium: 0.4, hard: 0.2 },
      },
    ],
  },
  {
    key: "listening_quick_25",
    label: "Listening Quick (25 min)",
    description: "Compact listening paper covering all 4 TOEIC parts in 25 min, 22 items, B1. Transcripts + choices ready for TTS / image-gen.",
    paperName: "Listening Quick Test (25 min)",
    paperDescription: "Short listening paper with Photographs, Question-Response, Conversations, and Short Talks. Designed for ~25 minutes of audio testing.",
    timeLimit: 25,
    sections: [
      {
        name: "Part 1 — Photographs",
        skill: "listening",
        cefr: "B1",
        topic: "workplace, daily-life, transport, and street photographs: people working, walking, dining, shopping, commuting",
        passage_length: "none",
        item_count: 4,
        section_score: 4,
        section_time_min: 4,
        question_types: ["photo_description"],
        difficulty_mix: { easy: 0.5, medium: 0.4, hard: 0.1 },
      },
      {
        name: "Part 2 — Question-Response",
        skill: "listening",
        cefr: "B1",
        topic: "workplace and service-encounter wh-questions, yes/no questions, and tag questions",
        passage_length: "none",
        item_count: 6,
        section_score: 6,
        section_time_min: 5,
        question_types: ["question_response"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Part 3 — Conversations",
        skill: "listening",
        cefr: "B1",
        topic: "short business conversations between 2-3 speakers (office, customer service, travel). One transcript with 3 comprehension questions.",
        passage_length: "60-90 words",
        item_count: 6,
        section_score: 6,
        section_time_min: 8,
        question_types: ["main_idea", "detail", "inference"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Part 4 — Short Talks",
        skill: "listening",
        cefr: "B1",
        topic: "short monologues: announcements, voicemails, news bulletins, advertisements. One transcript with 3 comprehension questions.",
        passage_length: "80-120 words",
        item_count: 6,
        section_score: 6,
        section_time_min: 8,
        question_types: ["main_idea", "detail", "tone_purpose"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
    ],
  },
  {
    key: "toeic_listening",
    label: "TOEIC Listening (4 Parts)",
    description: "TOEIC Listening: Photographs, Question-Response, Conversations, Short Talks. 4 sections, ~30 items, B1–B2. Outputs transcripts + choices ready for TTS.",
    paperName: "TOEIC Listening Practice",
    paperDescription: "Listening paper modelled on TOEIC L&R Parts 1-4. Each item produces a transcript and MCQ choices intended to be voiced by TTS.",
    timeLimit: 45,
    sections: [
      {
        name: "Part 1 — Photographs",
        skill: "listening",
        cefr: "B1",
        topic: "workplace, daily-life, transport, and street photographs: people working, walking, dining, shopping, commuting",
        passage_length: "none",
        item_count: 6,
        section_score: 6,
        section_time_min: 5,
        question_types: ["photo_description"],
        difficulty_mix: { easy: 0.5, medium: 0.4, hard: 0.1 },
      },
      {
        name: "Part 2 — Question-Response",
        skill: "listening",
        cefr: "B1",
        topic: "workplace and service-encounter wh-questions, yes/no questions, and tag questions",
        passage_length: "none",
        item_count: 9,
        section_score: 9,
        section_time_min: 8,
        question_types: ["question_response"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Part 3 — Conversations",
        skill: "listening",
        cefr: "B1",
        topic: "short business conversations between 2-3 speakers (office, customer service, travel, meetings). One transcript with 3 comprehension questions.",
        passage_length: "60-90 words",
        item_count: 9,
        section_score: 9,
        section_time_min: 15,
        question_types: ["main_idea", "detail", "inference"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Part 4 — Short Talks",
        skill: "listening",
        cefr: "B2",
        topic: "short monologues: announcements, voicemails, news bulletins, advertisements, broadcasts. One transcript with 3 comprehension questions.",
        passage_length: "80-120 words",
        item_count: 9,
        section_score: 9,
        section_time_min: 15,
        question_types: ["main_idea", "detail", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.5, hard: 0.3 },
      },
    ],
  },
  {
    key: "workplace_reading",
    label: "Workplace Reading",
    description: "Employee reading assessment: emails, memos, reports, policies. 4 passages, 24 items, B1–B2, ~40 min.",
    paperName: "Workplace Reading Assessment",
    paperDescription: "Reading proficiency test for company employees. Authentic workplace documents with comprehension and inference tasks.",
    timeLimit: 40,
    sections: [
      {
        name: "Business Email",
        skill: "reading",
        cefr: "B1",
        topic: "internal and client-facing emails: meeting requests, project updates, follow-ups, scheduling, polite complaints",
        item_count: 6,
        section_score: 6,
        section_time_min: 10,
        question_types: ["main_idea", "detail", "inference"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Memo & Announcement",
        skill: "reading",
        cefr: "B1",
        topic: "company memos and announcements: new policies, office moves, HR notices, IT outages, training invitations",
        item_count: 6,
        section_score: 6,
        section_time_min: 10,
        question_types: ["main_idea", "detail", "tone_purpose"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Report & Data Summary",
        skill: "reading",
        cefr: "B2",
        topic: "short business reports: quarterly performance summaries, market updates, project status reports with figures",
        item_count: 6,
        section_score: 6,
        section_time_min: 10,
        question_types: ["main_idea", "detail", "inference", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
      {
        name: "Policy & Procedure",
        skill: "reading",
        cefr: "B2",
        topic: "workplace policies: leave, expense, code of conduct, remote-work, data-privacy procedures",
        item_count: 6,
        section_score: 6,
        section_time_min: 10,
        question_types: ["detail", "inference", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
    ],
  },
  {
    key: "workplace_conversation",
    label: "Workplace Conversation",
    description: "Functional spoken English for employees: meetings, calls, customer service, small talk. 24 items, B1–B2, ~30 min.",
    paperName: "Workplace Conversation Assessment",
    paperDescription: "Tests an employee's ability to handle common spoken interactions at work via dialogue-completion and best-response items.",
    timeLimit: 30,
    sections: [
      {
        name: "Meetings & Discussions",
        skill: "integrated",
        cefr: "B1",
        topic: "internal meetings: agreeing/disagreeing politely, asking for clarification, summarising, interrupting, presenting an opinion",
        item_count: 6,
        section_score: 6,
        section_time_min: 8,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.3, medium: 0.6, hard: 0.1 },
      },
      {
        name: "Phone & Video Calls",
        skill: "integrated",
        cefr: "B1",
        topic: "telephone and video calls: taking messages, scheduling, confirming details, handling poor connection, polite hold/transfer phrases",
        item_count: 6,
        section_score: 6,
        section_time_min: 7,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.3, medium: 0.6, hard: 0.1 },
      },
      {
        name: "Customer Service & Clients",
        skill: "integrated",
        cefr: "B2",
        topic: "customer and client interactions: handling complaints, apologising, negotiating deadlines, confirming requirements, soft-selling",
        item_count: 6,
        section_score: 6,
        section_time_min: 8,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
      {
        name: "Small Talk & Networking",
        skill: "integrated",
        cefr: "B1",
        topic: "professional small talk: introductions, weekend plans, office events, conferences, polite topic-change and exit phrases",
        item_count: 6,
        section_score: 6,
        section_time_min: 7,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
    ],
  },
  {
    key: "workplace_grammar",
    label: "Workplace Grammar",
    description: "Business-writing grammar for employees: tenses, modals, conditionals, error-spotting in emails. 30 items, B1–B2, ~30 min.",
    paperName: "Workplace Grammar Assessment",
    paperDescription: "Targets the grammar most common in business writing — tense choice, modals, conditionals, articles, and error correction.",
    timeLimit: 30,
    sections: [
      {
        name: "Tense & Aspect in Reports",
        skill: "grammar",
        cefr: "B1",
        topic: "tense usage in status updates, project reports, and meeting minutes: past simple vs present perfect, future forms for plans",
        item_count: 8,
        section_score: 8,
        section_time_min: 8,
        question_types: ["multiple_choice", "fill_blank"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Modals & Polite Language",
        skill: "grammar",
        cefr: "B1",
        topic: "modal verbs in workplace requests, suggestions, and obligations: could/would/should/must/might in emails",
        item_count: 8,
        section_score: 8,
        section_time_min: 8,
        question_types: ["multiple_choice", "fill_blank"],
        difficulty_mix: { easy: 0.3, medium: 0.6, hard: 0.1 },
      },
      {
        name: "Conditionals & Hypotheticals",
        skill: "grammar",
        cefr: "B2",
        topic: "first, second, and third conditionals in business contexts: negotiations, risk discussions, after-action reviews",
        item_count: 7,
        section_score: 7,
        section_time_min: 7,
        question_types: ["multiple_choice", "fill_blank"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
      {
        name: "Error Spotting in Emails",
        skill: "grammar",
        cefr: "B2",
        topic: "common errors in business emails: article use, subject-verb agreement, preposition choice, run-on sentences",
        item_count: 7,
        section_score: 7,
        section_time_min: 7,
        question_types: ["error_identification"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
    ],
  },
  {
    key: "workplace_vocabulary",
    label: "Workplace Vocabulary",
    description: "Business vocabulary for employees: collocations, idioms, phrasal verbs, vocab-in-context. 28 items, B1–B2, ~25 min.",
    paperName: "Workplace Vocabulary Assessment",
    paperDescription: "Tests the everyday and business-specific vocabulary an employee needs for emails, meetings, and reports.",
    timeLimit: 25,
    sections: [
      {
        name: "Business Collocations",
        skill: "vocabulary",
        cefr: "B1",
        topic: "common business collocations: meet a deadline, hold a meeting, reach a decision, take action, raise an issue",
        item_count: 8,
        section_score: 8,
        section_time_min: 6,
        question_types: ["multiple_choice", "fill_blank"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Phrasal Verbs at Work",
        skill: "vocabulary",
        cefr: "B1",
        topic: "workplace phrasal verbs: follow up, get back to, sign off, take on, run by, deal with, look into",
        item_count: 7,
        section_score: 7,
        section_time_min: 6,
        question_types: ["multiple_choice", "fill_blank"],
        difficulty_mix: { easy: 0.3, medium: 0.6, hard: 0.1 },
      },
      {
        name: "Office Idioms & Expressions",
        skill: "vocabulary",
        cefr: "B2",
        topic: "common office idioms: touch base, ballpark figure, on the same page, drop the ball, think outside the box",
        item_count: 6,
        section_score: 6,
        section_time_min: 6,
        question_types: ["multiple_choice", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
      {
        name: "Vocabulary in Business Context",
        skill: "vocabulary",
        cefr: "B2",
        topic: "department- and function-specific vocabulary: HR, finance, IT, sales, operations terminology used in short business passages",
        item_count: 7,
        section_score: 7,
        section_time_min: 7,
        question_types: ["vocabulary_in_context", "multiple_choice"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
    ],
  },
  {
    key: "toeic_lr",
    label: "TOEIC Listening & Reading",
    description: "TOEIC L&R style: 5 parts spanning conversations, talks, incomplete sentences, text completion, and reading. ~60 items, B1–C1.",
    paperName: "TOEIC Practice (Listening & Reading)",
    paperDescription: "Workplace-focused English assessment mirroring the TOEIC L&R format. Auto-gradable MCQ throughout.",
    timeLimit: 120,
    sections: [
      {
        name: "Part 3 — Conversations (Listening)",
        skill: "listening",
        cefr: "B1",
        topic: "short business conversations between two or three speakers (office, customer service, travel, meetings)",
        item_count: 9,
        section_score: 9,
        section_time_min: 15,
        question_types: ["multiple_choice", "main_idea", "detail", "inference"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Part 4 — Short Talks (Listening)",
        skill: "listening",
        cefr: "B2",
        topic: "short monologues: announcements, voicemails, news reports, advertisements, broadcasts",
        item_count: 9,
        section_score: 9,
        section_time_min: 15,
        question_types: ["multiple_choice", "main_idea", "detail", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.5, hard: 0.3 },
      },
      {
        name: "Part 5 — Incomplete Sentences (Grammar)",
        skill: "grammar",
        cefr: "B2",
        topic: null,
        item_count: 15,
        section_score: 15,
        section_time_min: 12,
        question_types: ["multiple_choice", "fill_blank"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Part 6 — Text Completion",
        skill: "reading",
        cefr: "B2",
        topic: "business email, internal memo, notice, or short article with 4 blanks",
        item_count: 8,
        section_score: 8,
        section_time_min: 10,
        question_types: ["cloze", "fill_blank"],
        difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
      },
      {
        name: "Part 7 — Reading Comprehension",
        skill: "reading",
        cefr: "C1",
        topic: "business documents: emails, articles, advertisements, schedules, double passages",
        item_count: 15,
        section_score: 15,
        section_time_min: 35,
        question_types: ["multiple_choice", "main_idea", "detail", "inference", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.2, medium: 0.5, hard: 0.3 },
      },
    ],
  },
  {
    key: "onet_m6",
    label: "O-NET English (M.6)",
    description: "Thai national O-NET English (Grade 12) layout: conversation, vocabulary, grammar, reading, writing. ~50 items, A2–B2.",
    paperName: "O-NET English (Mathayom 6)",
    paperDescription: "Practice paper mirroring the Thai O-NET English exam for upper-secondary students.",
    timeLimit: 90,
    sections: [
      {
        name: "Conversation / Expressions",
        skill: "integrated",
        cefr: "A2",
        topic: "everyday dialogues: greetings, requests, suggestions, apologies, polite responses, school and shopping situations",
        item_count: 10,
        section_score: 10,
        section_time_min: 15,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.5, medium: 0.4, hard: 0.1 },
      },
      {
        name: "Vocabulary",
        skill: "vocabulary",
        cefr: "B1",
        topic: "synonyms, antonyms, collocations, and word usage in school and daily-life contexts",
        item_count: 10,
        section_score: 10,
        section_time_min: 10,
        question_types: ["multiple_choice", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.4, medium: 0.5, hard: 0.1 },
      },
      {
        name: "Grammar & Structure",
        skill: "grammar",
        cefr: "B1",
        topic: null,
        item_count: 10,
        section_score: 10,
        section_time_min: 15,
        question_types: ["multiple_choice", "fill_blank", "error_identification"],
        difficulty_mix: { easy: 0.4, medium: 0.4, hard: 0.2 },
      },
      {
        name: "Reading Comprehension",
        skill: "reading",
        cefr: "B2",
        topic: "advertisements, signs, short articles, and informational passages relevant to Thai students",
        item_count: 15,
        section_score: 15,
        section_time_min: 30,
        question_types: ["main_idea", "detail", "inference", "vocabulary_in_context", "tone_purpose"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Writing (Short Response)",
        skill: "writing",
        cefr: "B1",
        topic: "guided paragraph: opinion, description, or short narrative on a familiar topic",
        item_count: 1,
        section_score: 10,
        section_time_min: 20,
        question_types: ["essay"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
    ],
  },
  {
    key: "tgat_eng",
    label: "TGAT English Communication",
    description: "TGAT Part 3 (English Communication): 60 items / 60 min — conversation (30) + reading (30) with vocabulary in context. B1–B2.",
    paperName: "TGAT English Communication",
    paperDescription: "Thai university-admission TGAT3 English section: split evenly between functional conversation and reading.",
    timeLimit: 60,
    sections: [
      {
        name: "Conversation — Dialogue Completion",
        skill: "integrated",
        cefr: "B1",
        topic: "two-person dialogues: opening/closing conversations, polite requests, suggestions, agreement/disagreement, problem-solving",
        item_count: 15,
        section_score: 15,
        section_time_min: 15,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      },
      {
        name: "Conversation — Functional Expressions",
        skill: "integrated",
        cefr: "B2",
        topic: "service encounters and workplace scenarios: best-response selection, register, indirect language",
        item_count: 15,
        section_score: 15,
        section_time_min: 15,
        question_types: ["multiple_choice"],
        difficulty_mix: { easy: 0.2, medium: 0.5, hard: 0.3 },
      },
      {
        name: "Reading — Vocabulary in Context",
        skill: "reading",
        cefr: "B2",
        topic: "short academic and general-interest passages emphasising word meaning from context",
        item_count: 15,
        section_score: 15,
        section_time_min: 15,
        question_types: ["vocabulary_in_context", "multiple_choice"],
        difficulty_mix: { easy: 0.2, medium: 0.6, hard: 0.2 },
      },
      {
        name: "Reading — Comprehension",
        skill: "reading",
        cefr: "B2",
        topic: "articles, advertisements, infographics and announcements with main-idea, detail and inference questions",
        item_count: 15,
        section_score: 15,
        section_time_min: 15,
        question_types: ["main_idea", "detail", "inference", "tone_purpose"],
        difficulty_mix: { easy: 0.2, medium: 0.5, hard: 0.3 },
      },
    ],
  },
  {
    key: "tpat1_eng",
    label: "TPAT1 Critical Reading (English)",
    description: "TPAT1 (medical-aptitude) English-passage style: critical reading, inference, tone & purpose, vocabulary in context. C1.",
    paperName: "TPAT1 English Critical Reading",
    paperDescription: "Advanced critical-reading practice modelled on TPAT1 medical-aptitude English passages.",
    timeLimit: 60,
    sections: [
      {
        name: "Critical Reading — Scientific Passage",
        skill: "reading",
        cefr: "C1",
        topic: "medical, biology, or health-science article with technical vocabulary and reasoning chains",
        item_count: 10,
        section_score: 10,
        section_time_min: 20,
        question_types: ["main_idea", "detail", "inference", "tone_purpose", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.1, medium: 0.5, hard: 0.4 },
      },
      {
        name: "Critical Reading — Argumentative Passage",
        skill: "reading",
        cefr: "C1",
        topic: "opinion editorial or persuasive essay on ethics, society, or science policy",
        item_count: 10,
        section_score: 10,
        section_time_min: 20,
        question_types: ["main_idea", "inference", "tone_purpose", "vocabulary_in_context"],
        difficulty_mix: { easy: 0.1, medium: 0.5, hard: 0.4 },
      },
      {
        name: "Vocabulary in Academic Context",
        skill: "vocabulary",
        cefr: "C1",
        topic: "academic and scientific vocabulary; nuanced synonyms, formal register",
        item_count: 10,
        section_score: 10,
        section_time_min: 10,
        question_types: ["vocabulary_in_context", "multiple_choice"],
        difficulty_mix: { easy: 0.1, medium: 0.5, hard: 0.4 },
      },
      {
        name: "Short Answer — Critical Response",
        skill: "reading",
        cefr: "C1",
        topic: "responding to a short passage with a 1-3 sentence justification",
        item_count: 5,
        section_score: 10,
        section_time_min: 10,
        question_types: ["short_answer"],
        difficulty_mix: { easy: 0.1, medium: 0.5, hard: 0.4 },
      },
    ],
  },
  {
    key: "cefr_placement",
    label: "CEFR Placement Test (A2–C2)",
    description: "Vocabulary → Grammar → Conversation → Reading, A2–C2. 60 items, 60 points, ~60 min. Fully auto-gradable.",
    paperName: "CEFR-based English Placement Test",
    paperDescription: "Auto-gradable placement across A2–C2 covering vocabulary, grammar, functional conversation, and reading.",
    timeLimit: 60,
    sections: (() => {
      const levels = ["A2", "B1", "B2", "C1", "C2"];
      const skillDefs = [
        {
          display: "Vocabulary",
          skill: "vocabulary",
          topic: "everyday vocabulary, collocations, and word forms" as string | null,
          question_types: ["multiple_choice", "vocabulary_in_context"],
          itemsPerLevel: 3,
          timePerLevel: 3,
        },
        {
          display: "Grammar",
          skill: "grammar",
          topic: null as string | null,
          question_types: ["multiple_choice", "fill_blank", "error_identification"],
          itemsPerLevel: 3,
          timePerLevel: 3,
        },
        {
          display: "Conversation",
          skill: "integrated",
          topic: "workplace and everyday situations: polite requests, customer service, dialogue completion, best-response choices" as string | null,
          question_types: ["multiple_choice"],
          itemsPerLevel: 2,
          timePerLevel: 2,
        },
        {
          display: "Reading",
          skill: "reading",
          topic: "everyday situations, workplace, and short articles" as string | null,
          question_types: ["main_idea", "detail", "inference", "vocabulary_in_context"],
          itemsPerLevel: 4,
          timePerLevel: 4,
        },
      ];
      const out: SectionDraft[] = [];
      for (const s of skillDefs) {
        for (const lvl of levels) {
          out.push({
            name: `${s.display} ${lvl}`,
            skill: s.skill,
            cefr: lvl,
            topic: s.topic,
            item_count: s.itemsPerLevel,
            section_score: s.itemsPerLevel,
            section_time_min: s.timePerLevel,
            question_types: s.question_types,
            difficulty_mix: { easy: 0.25, medium: 0.5, hard: 0.25 },
          });
        }
      }
      return out;
    })(),
  },
];

const cloneSections = (sections: SectionDraft[]): SectionDraft[] =>
  sections.map((s) => ({
    ...s,
    question_types: [...s.question_types],
    difficulty_mix: s.difficulty_mix ? { ...s.difficulty_mix } : undefined,
  }));

export function PaperCreatePage() {
  const [name, setName] = useState("English Competency Test");
  const [description, setDescription] = useState("");
  const [timeLimit, setTimeLimit] = useState(60);
  const [sections, setSections] = useState<SectionDraft[]>([defaultSection(1)]);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [activeTemplate, setActiveTemplate] = useState<string>("blank");
  const [showReview, setShowReview] = useState(false);
  const mutation = useMutation({
    mutationFn: createPaper,
    onSuccess: () => setShowReview(false),
  });

  const submitPaper = () => {
    mutation.mutate({
      name,
      description: description || null,
      time_limit_min: timeLimit || null,
      total_score: totalScore,
      sections,
    });
  };

  const applyTemplate = (template: PaperTemplate) => {
    setActiveTemplate(template.key);
    setName(template.paperName);
    setDescription(template.paperDescription || "");
    setTimeLimit(template.timeLimit);
    setSections(cloneSections(template.sections));
    setCollapsed({});
  };

  const updateSection = (index: number, patch: Partial<SectionDraft>) => {
    setSections((current) => current.map((section, idx) => idx === index ? { ...section, ...patch } : section));
  };

  const totalScore = useMemo(
    () => sections.reduce((sum, s) => sum + Number(s.section_score || 0), 0),
    [sections],
  );
  const totalItems = useMemo(
    () => sections.reduce((sum, s) => sum + Number(s.item_count || 0), 0),
    [sections],
  );

  const paperEstimate = useMemo(() => {
    return sections.reduce(
      (acc, s) => {
        // Paper sections skip Blueprint (pre-seeded). Forced 1× revision.
        const e = estimateTokens({ itemCount: Number(s.item_count) || 1, skipBlueprint: true, revisions: 1 });
        return { tokens: acc.tokens + e.total_tokens, cost: acc.cost + e.cost_usd };
      },
      { tokens: 0, cost: 0 },
    );
  }, [sections]);

  const toggleCollapse = (index: number) => {
    setCollapsed((current) => ({ ...current, [index]: !current[index] }));
  };

  const selectSkill = (index: number, nextSkill: string) => {
    const allowed = new Set(
      QUESTION_TYPE_DEFS.filter((q) => q.skills.includes(nextSkill)).map((q) => q.key),
    );
    const filteredTypes = sections[index].question_types.filter((t) => allowed.has(t));
    const usesSourceText = SOURCE_TEXT_SKILLS.has(nextSkill);
    updateSection(index, {
      skill: nextSkill,
      question_types: filteredTypes.length ? filteredTypes : Array.from(allowed).slice(0, 1),
      passage_length: usesSourceText ? sections[index].passage_length || null : null,
    });
  };

  const toggleQuestionType = (index: number, key: string) => {
    const current = sections[index].question_types;
    const next = current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key];
    updateSection(index, { question_types: next });
  };

  const updateMix = (index: number, key: "easy" | "medium" | "hard", value: number) => {
    const current = sections[index].difficulty_mix || { easy: 0, medium: 0, hard: 0 };
    updateSection(index, { difficulty_mix: { ...current, [key]: value } });
  };

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1 className="page-title">Create Paper</h1>
          <p className="page-subtitle">Compose a structured multi-section paper. Each section runs as its own background generation job.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn" to="/papers">View papers</Link>
        </div>
      </header>

      {/* Summary stat bar */}
      <div className="paper-stats">
        <StatTile label="Sections" value={String(sections.length)} />
        <StatTile label="Total items" value={String(totalItems)} />
        <StatTile label="Total score" value={String(totalScore)} highlight />
        <StatTile label="Time limit" value={timeLimit ? `${timeLimit} min` : "—"} />
        <StatTile
          label="Est. tokens"
          value={formatTokens(paperEstimate.tokens)}
          sub={`${formatUSD(paperEstimate.cost)} · ${formatTHB(paperEstimate.cost)}`}
        />
      </div>

      <Card>
        <CardHeader
          title="Templates"
          description="Quick-start from a curated preset. Picking a template replaces all current sections."
        />
        <div className="card-body">
          <div className="template-grid">
            {PAPER_TEMPLATES.map((template) => (
              <button
                type="button"
                key={template.key}
                className={`template-card ${activeTemplate === template.key ? "selected" : ""}`}
                onClick={() => applyTemplate(template)}
              >
                <div className="template-card-head">
                  <strong>{template.label}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {template.sections.length} section{template.sections.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="template-card-desc">{template.description}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Paper Details" description="Top-level metadata shown to candidates when they take this paper." />
        <div className="card-body stack">
          <div className="grid-2">
            <Field label="Paper name">
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Time limit (minutes)">
              <input type="number" min={0} value={timeLimit} onChange={(event) => setTimeLimit(Number(event.target.value) || 0)} />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional summary shown to candidates."
              rows={2}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Sections (${sections.length})`}
          description="Each section is generated independently in parallel. A failure in one section won't fail the whole paper."
          actions={
            <Button onClick={() => setSections((current) => [...current, defaultSection(current.length + 1)])}>
              + Add section
            </Button>
          }
        />
        <div className="card-body stack">
          {sections.map((section, index) => {
            const isCollapsed = collapsed[index];
            const compatibleTypes = QUESTION_TYPE_DEFS.filter((q) => q.skills.includes(section.skill));
            const mix = section.difficulty_mix || { easy: 0, medium: 0, hard: 0 };
            const mixTotal = mix.easy + mix.medium + mix.hard;
            const mixOk = Math.abs(mixTotal - 1) < 0.01;
            const canUseSourceText = SOURCE_TEXT_SKILLS.has(section.skill);

            return (
              <div className="section-card" key={index}>
                <div className="section-card-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="section-index">{index + 1}</span>
                    <input
                      className="section-name-input"
                      value={section.name}
                      onChange={(event) => updateSection(index, { name: event.target.value })}
                    />
                    <span className="badge">{section.skill}</span>
                    <span className="badge">{section.cefr}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {section.item_count} items · {section.section_score} pts
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn" onClick={() => toggleCollapse(index)}>
                      {isCollapsed ? "Expand" : "Collapse"}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => setSections((current) => current.filter((_, idx) => idx !== index))}
                      disabled={sections.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {isCollapsed ? null : (
                  <div className="section-card-body stack">
                    {/* Skill picker */}
                    <div>
                      <label className="field-label">Skill</label>
                      <div className="segmented">
                        {SKILLS.map((s) => (
                          <button
                            type="button"
                            key={s.key}
                            className={`skill-pill ${section.skill === s.key ? "selected" : ""}`}
                            onClick={() => selectSkill(index, s.key)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* CEFR picker */}
                    <div>
                      <label className="field-label">CEFR level</label>
                      <div className="segmented">
                        {CEFRS.map((level) => (
                          <button
                            type="button"
                            key={level}
                            className={`chip ${section.cefr === level ? "active" : ""}`}
                            onClick={() => updateSection(index, { cefr: level })}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Numeric fields */}
                    <div className="grid-3">
                      <Field label="Items">
                        <input
                          type="number"
                          min={1}
                          value={section.item_count}
                          onChange={(event) => updateSection(index, { item_count: Number(event.target.value) || 1 })}
                        />
                      </Field>
                      <Field label="Section score">
                        <input
                          type="number"
                          min={1}
                          value={section.section_score}
                          onChange={(event) => updateSection(index, { section_score: Number(event.target.value) || 1 })}
                        />
                      </Field>
                      <Field label="Time (min, optional)">
                        <input
                          type="number"
                          min={0}
                          value={section.section_time_min || ""}
                          onChange={(event) => updateSection(index, { section_time_min: Number(event.target.value) || null })}
                          placeholder="Auto"
                        />
                      </Field>
                    </div>

                    <Field label="Topic (optional)">
                      <input
                        value={section.topic || ""}
                        onChange={(event) => updateSection(index, { topic: event.target.value || null })}
                        placeholder="e.g. workplace communication, environmental science"
                      />
                    </Field>

                    {canUseSourceText ? (
                      <Field label="Source length">
                        <select
                          value={section.passage_length || ""}
                          onChange={(event) => updateSection(index, { passage_length: event.target.value || null })}
                        >
                          {PASSAGE_LENGTH_OPTIONS.map((option) => (
                            <option key={option.value || "default"} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}

                    {/* Question types */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <label className="field-label" style={{ margin: 0 }}>
                          Question types <span className="muted" style={{ fontWeight: 400 }}>· compatible with "{section.skill}"</span>
                        </label>
                        {section.question_types.length ? (
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            onClick={() => updateSection(index, { question_types: [] })}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <div className="qtype-grid">
                        {compatibleTypes.map((q) => {
                          const selected = section.question_types.includes(q.key);
                          return (
                            <label key={q.key} className={`qtype-card ${selected ? "selected" : ""}`}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleQuestionType(index, q.key)}
                              />
                              <span className="qtype-label">{q.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {!section.question_types.length ? (
                        <div className="muted" style={{ fontSize: 11, marginTop: 6, color: "var(--danger)" }}>
                          Pick at least one question type.
                        </div>
                      ) : null}
                    </div>

                    {/* Difficulty mix */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <label className="field-label" style={{ margin: 0 }}>Difficulty mix</label>
                        <span className={`muted ${mixOk ? "" : "mix-warn"}`} style={{ fontSize: 11 }}>
                          Sum: {mixTotal.toFixed(2)} {mixOk ? "✓" : "(should be 1.00)"}
                        </span>
                      </div>
                      <div className="grid-3">
                        <MixSlider
                          label="Easy"
                          value={mix.easy}
                          onChange={(v) => updateMix(index, "easy", v)}
                          color="#16a34a"
                        />
                        <MixSlider
                          label="Medium"
                          value={mix.medium}
                          onChange={(v) => updateMix(index, "medium", v)}
                          color="#d97706"
                        />
                        <MixSlider
                          label="Hard"
                          value={mix.hard}
                          onChange={(v) => updateMix(index, "hard", v)}
                          color="#dc2626"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Sticky action footer */}
      <div className="paper-actions">
        <div className="muted" style={{ fontSize: 13 }}>
          {sections.length} section{sections.length === 1 ? "" : "s"} · {totalItems} items · {totalScore} pts total
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {mutation.data ? (
            <Link className="btn" to={`/papers/${mutation.data.id}`}>Open created paper →</Link>
          ) : null}
          <Button
            variant="primary"
            disabled={!sections.length || sections.some((s) => !s.question_types.length)}
            onClick={() => setShowReview(true)}
          >
            Create paper
          </Button>
        </div>
      </div>

      {showReview ? (
        <ReviewModal
          name={name}
          description={description}
          timeLimit={timeLimit}
          totalScore={totalScore}
          totalItems={totalItems}
          sections={sections}
          submitting={mutation.isPending}
          error={mutation.error}
          onCancel={() => mutation.isPending ? null : setShowReview(false)}
          onConfirm={submitPaper}
        />
      ) : null}
    </div>
  );
}

interface ReviewModalProps {
  name: string;
  description: string;
  timeLimit: number;
  totalScore: number;
  totalItems: number;
  sections: SectionDraft[];
  submitting: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}

function ReviewModal({ name, description, timeLimit, totalScore, totalItems, sections, submitting, error, onCancel, onConfirm }: ReviewModalProps) {
  const totalTime = sections.reduce((s, x) => s + Number(x.section_time_min || 0), 0);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-shell" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">Review Paper</h2>
            <p className="modal-sub muted">Confirm the configuration before creating the paper. Each section will start as a background generation job.</p>
          </div>
          <button type="button" className="btn" onClick={onCancel} disabled={submitting} aria-label="Close">✕</button>
        </div>

        <div className="modal-body stack">
          <div className="summary-meta">
            <div>
              <div className="summary-paper-name">{name || <span className="muted">(untitled paper)</span>}</div>
              {description ? <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{description}</div> : null}
            </div>
            <div className="summary-meta-stats">
              <span><strong>{sections.length}</strong> sections</span>
              <span>·</span>
              <span><strong>{totalItems}</strong> items</span>
              <span>·</span>
              <span><strong>{totalScore}</strong> pts</span>
              <span>·</span>
              <span><strong>{timeLimit || "—"}</strong> min</span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table summary-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Section</th>
                  <th>Skill</th>
                  <th>CEFR</th>
                  <th style={{ textAlign: "right" }}>Items</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                  <th style={{ textAlign: "right" }}>Time</th>
                  <th>Question types</th>
                  <th>Difficulty mix</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section, index) => {
                  const mix = section.difficulty_mix || { easy: 0, medium: 0, hard: 0 };
                  const mixTotal = mix.easy + mix.medium + mix.hard;
                  const mixOk = Math.abs(mixTotal - 1) < 0.01;
                  return (
                    <tr key={index}>
                      <td className="muted">{index + 1}</td>
                      <td>
                        <strong>{section.name}</strong>
                        {section.topic ? (
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Topic: {section.topic}</div>
                        ) : null}
                        {section.passage_length ? (
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Source: {section.passage_length}</div>
                        ) : null}
                      </td>
                      <td><span className="badge">{section.skill}</span></td>
                      <td><span className="badge">{section.cefr}</span></td>
                      <td style={{ textAlign: "right" }}>{section.item_count}</td>
                      <td style={{ textAlign: "right" }}>{section.section_score}</td>
                      <td style={{ textAlign: "right" }}>{section.section_time_min || <span className="muted">—</span>}</td>
                      <td>
                        {section.question_types.length ? (
                          <div className="summary-qtype-list">
                            {section.question_types.map((key) => (
                              <span key={key} className="chip" style={{ fontSize: 11, padding: "3px 8px" }}>
                                {TYPE_LABELS[key] || key}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted" style={{ color: "var(--danger)" }}>none</span>
                        )}
                      </td>
                      <td>
                        <MixBar mix={mix} />
                        {!mixOk ? (
                          <div className="mix-warn" style={{ fontSize: 11, marginTop: 4 }}>
                            sum {mixTotal.toFixed(2)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>Total</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{totalItems}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{totalScore}</strong></td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{totalTime || "—"}</strong>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          {error ? <ErrorState error={error} /> : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <Button variant="primary" disabled={submitting} onClick={onConfirm}>
            {submitting ? "Creating..." : "Confirm & Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, highlight, sub }: { label: string; value: string; highlight?: boolean; sub?: string }) {
  return (
    <div className={`stat-tile ${highlight ? "highlight" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub muted" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function MixBar({ mix }: { mix: { easy: number; medium: number; hard: number } }) {
  const total = mix.easy + mix.medium + mix.hard || 1;
  const segments = [
    { key: "easy",   value: mix.easy,   color: "#16a34a" },
    { key: "medium", value: mix.medium, color: "#d97706" },
    { key: "hard",   value: mix.hard,   color: "#dc2626" },
  ];
  return (
    <div className="mix-bar" title={`Easy ${(mix.easy*100).toFixed(0)}% / Medium ${(mix.medium*100).toFixed(0)}% / Hard ${(mix.hard*100).toFixed(0)}%`}>
      {segments.map((seg) => seg.value > 0 ? (
        <div
          key={seg.key}
          className="mix-bar-seg"
          style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }}
        >
          {seg.value >= 0.15 ? `${Math.round((seg.value / total) * 100)}%` : ""}
        </div>
      ) : null)}
    </div>
  );
}

function MixSlider({ label, value, onChange, color }: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div className="mix-slider">
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color, fontWeight: 650 }}>{label}</span>
        <span className="mono">{(value * 100).toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: color }}
      />
    </div>
  );
}
