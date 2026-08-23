import type { ScriptFile } from "@lucent/core/scriptInputs";

export const SCRIPT_FILE_MAX_BYTES = 16 * 1024 * 1024;
export const SCRIPT_FILE_WORKER_HEAP_MB = 256;
export const SCRIPT_FILE_WORKER_QUEUE_LIMIT = 64;
export const SCRIPT_FILE_WORKER_TIMEOUT_MS = 10_000;

export interface ScriptFileWorkerRequest {
  readonly id: number;
  readonly path: string;
}

export interface ScriptFileAnalysis {
  readonly file: ScriptFile;
  readonly fingerprint: string;
  readonly requirements: readonly string[];
}

export type ScriptFileAnalysisResolution =
  | { readonly status: "found"; readonly analysis: ScriptFileAnalysis }
  | { readonly status: "missing"; readonly path: string }
  | {
      readonly status: "failed";
      readonly path: string;
      readonly message: string;
      readonly detailsText?: string;
    };

export interface ScriptFileWorkerResponse {
  readonly id: number;
  readonly resolution: ScriptFileAnalysisResolution;
}
