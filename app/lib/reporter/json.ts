import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "../validation";
import { maskRunSummary } from "./mask";

export interface JsonReportOptions {
  reportsDir: string;
  maskKeys?: string[];
}

export async function writeJsonReport(
  summary: RunSummary,
  opts: JsonReportOptions,
): Promise<string> {
  const masked = maskRunSummary(summary, { maskKeys: opts.maskKeys });
  const outDir = path.join(opts.reportsDir, "json");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${summary.runId}.json`);
  await writeFile(outPath, JSON.stringify(masked, null, 2));
  return outPath;
}
