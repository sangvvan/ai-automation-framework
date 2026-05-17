import path from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../../config";
import { flagString } from "../args";
import type { CliCommand } from "../commands";

export const reportCommand: CliCommand = {
  help: {
    name: "report",
    summary: "Print the path to the HTML report for a given run id.",
    example: "ai-test report --run-id R-20260517-100000-abcd",
    options: [{ flag: "--run-id", description: "Run id" }],
  },
  run: async (args) => {
    const id = flagString(args, "run-id");
    if (!id) {
      process.stderr.write("Missing --run-id\n");
      return 1;
    }
    const cfg = loadConfig();
    const html = path.join(cfg.reportsDir, "html", id, "index.html");
    if (!existsSync(html)) {
      process.stderr.write(`Report not found: ${html}\n`);
      return 1;
    }
    process.stdout.write(html + "\n");
    return 0;
  },
};
