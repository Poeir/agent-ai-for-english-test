import { apiRequest } from "./apiClient";
import type { Passage, QuestionItem } from "../types/api";

export function listPassages(params = new URLSearchParams()) {
  const query = params.toString();
  return apiRequest<Passage[]>(`/api/v1/passages${query ? `?${query}` : ""}`);
}

export function listItems(params = new URLSearchParams()) {
  const query = params.toString();
  return apiRequest<QuestionItem[]>(`/api/v1/items${query ? `?${query}` : ""}`);
}
