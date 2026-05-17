import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config";
import { flagString } from "../args";
import { generateRunId } from "../run-id";
import { analyzePage } from "../../analyzer/analyze";
import type { CliCommand } from "../commands";

export const analyzeCommand: CliCommand = {
  help: {
    name: "analyze",
    summary: "Open a URL and write a PageAnalysis JSON + screenshot.",
    example: "ai-test analyze --url https://example.com",
    options: [
      { flag: "--url", description: "URL to analyze (required)" },
      { flag: "--output-dir", description: "Override evidence dir" },
    ],
  },
  run: async (args) => {
    const url = flagString(args, "url");
    if (!url) {
      process.stderr.write("Missing --url\n");
      return 1;
    }
    const cfg = loadConfig();
    const runId = generateRunId("A");
    const dir = flagString(args, "output-dir") ?? path.join(cfg.evidenceDir, runId);
    await mkdir(dir, { recursive: true });

    try {
      const analysis = await analyzePage({
        url,
        viewport: cfg.runner.viewport,
        screenshotPath: path.join(dir, "page.png"),
        headless: cfg.runner.headless,
        navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
      });
      const jsonPath = path.join(dir, "page-analysis.json");
      await writeFile(jsonPath, JSON.stringify(analysis, null, 2));
      process.stdout.write(`Run id: ${runId}\n`);
      process.stdout.write(`Analysis: ${jsonPath}\n`);
      process.stdout.write(`Screenshot: ${analysis.screenshotPath}\n`);
      return 0;
    } catch (err) {
      const msg = (err as Error).message;
      process.stderr.write(`Unreachable URL: ${msg}\n`);
      return 3;
    }
  },
};
