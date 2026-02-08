import type { ExtractedDataItem, ProofStep } from "@screenshare-guide/protocol";

export type SessionStatus = "idle" | "connecting" | "ready" | "active" | "completed" | "error";
export type UploadStatus = "idle" | "uploading" | "done" | "failed" | "skipped";

export interface TemplateData {
  id: string;
  name: string;
  description?: string;
  completionMessage?: string;
  steps: ProofStep[];
}

export type { ExtractedDataItem, ProofStep };
