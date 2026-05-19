import { apiRequest } from "./apiClient";
import type { JobResponse } from "../types/api";

export function createGenerationJob(payload: { requirement: string; item_count: number }) {
  return apiRequest<JobResponse>("/api/v1/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getJob(jobId: string) {
  return apiRequest<JobResponse>(`/api/v1/jobs/${jobId}`);
}

export function listJobs(params = new URLSearchParams()) {
  const query = params.toString();
  return apiRequest<JobResponse[]>(`/api/v1/jobs${query ? `?${query}` : ""}`);
}

export function cancelJob(jobId: string) {
  return apiRequest<JobResponse>(`/api/v1/jobs/${jobId}/cancel`, { method: "POST" });
}
