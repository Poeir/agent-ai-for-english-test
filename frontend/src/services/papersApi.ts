import { apiRequest } from "./apiClient";
import type { Paper, PaperCreateRequest, QuestionItem } from "../types/api";

export function listPapers(params = new URLSearchParams()) {
  const query = params.toString();
  return apiRequest<Paper[]>(`/api/v1/papers${query ? `?${query}` : ""}`);
}

export function createPaper(payload: PaperCreateRequest) {
  return apiRequest<Paper>("/api/v1/papers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPaper(paperId: string) {
  return apiRequest<Paper>(`/api/v1/papers/${paperId}`);
}

export function getPaperItems(paperId: string) {
  return apiRequest<QuestionItem[]>(`/api/v1/papers/${paperId}/items`);
}

export function cancelPaper(paperId: string) {
  return apiRequest<Paper>(`/api/v1/papers/${paperId}/cancel`, { method: "POST" });
}
