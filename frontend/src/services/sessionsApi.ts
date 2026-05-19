import { apiRequest } from "./apiClient";
import type { SessionResult, SessionStartResponse } from "../types/api";

export function startSession(payload: { paper_id: string; candidate_name: string }) {
  return apiRequest<SessionStartResponse>("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitAnswer(sessionId: string, payload: { item_id: string; answer: string }) {
  return apiRequest<{ ok: boolean; answered_count: number; total_count: number }>(`/api/v1/sessions/${sessionId}/answer`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitSession(sessionId: string) {
  return apiRequest<{ session_id: string; status: string }>(`/api/v1/sessions/${sessionId}/submit`, { method: "POST" });
}

export function getSessionResult(sessionId: string) {
  return apiRequest<SessionResult>(`/api/v1/sessions/${sessionId}/result`);
}
