import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface TraceEntry {
  at: string;
  provider: string;
  role: string;
  requestId: string;
  durationMs: number;
  status: "ok" | "error" | "fallback";
  attempt: number;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  cumulativeTokens?: number;
}

export interface Tracer {
  log(entry: TraceEntry): Promise<void>;
}

export function fileTracer(filePath: string): Tracer {
  return {
    async log(entry: TraceEntry) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, JSON.stringify(entry) + "\n");
    },
  };
}

export const noopTracer: Tracer = {
  async log() {
    /* noop */
  },
};
