import { readdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config";
import { flagString } from "../args";
import type { CliCommand } from "../commands";

const baselinesAccept: CliCommand = {
  help: {
    name: "baselines accept",
    summary: "Promote screenshots from a run into the canonical baselines.",
    example: "ai-test baselines accept --run-id R-20260601-...",
    options: [
      { flag: "--run-id", description: "Run id whose screenshots become the new baseline" },
      { flag: "--shot", description: "Only accept screenshots matching this name" },
    ],
  },
  run: async (args) => {
    const runId = flagString(args, "run-id");
    if (!runId) {
      process.stderr.write("Missing --run-id\n");
      return 1;
    }
    const shotFilter = flagString(args, "shot");
    const cfg = loadConfig();
    const evidenceRoot = path.join(cfg.evidenceDir, runId);
    const baselinesRoot = path.join(cfg.reportsDir, "baselines");

    let scanned = 0;
    let accepted = 0;
    try {
      const entries = await readdir(evidenceRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sub = path.join(evidenceRoot, entry.name);
        const files = await readdir(sub);
        for (const file of files) {
          if (!file.startsWith("screenshot-") || !file.endsWith(".png")) continue;
          scanned++;
          const shotName = file.replace(/^screenshot-/, "").replace(/\.png$/, "");
          if (shotFilter && shotFilter !== shotName) continue;
          const src = path.join(sub, file);
          // suite-slug/scenario-id derived from the evidence directory tree
          // is left as a single 'accepted' bucket here; the runner records
          // canonical paths via baseline-store at run time.
          const dest = path.join(
            baselinesRoot,
            "accepted",
            entry.name,
            `${shotName}.png`,
          );
          await copyFile(src, dest).catch(async (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              const mkdirp = (await import("node:fs/promises")).mkdir;
              await mkdirp(path.dirname(dest), { recursive: true });
              await copyFile(src, dest);
            } else {
              throw err;
            }
          });
          accepted++;
        }
      }
    } catch (err) {
      process.stderr.write(
        `baselines accept failed: ${(err as Error).message}\n`,
      );
      return 2;
    }

    process.stdout.write(
      `✓ Reviewed ${scanned} screenshot(s); promoted ${accepted} to ${baselinesRoot}/accepted/\n`,
    );
    return 0;

    void stat; // imported for potential future stat-based filtering
  },
};

export const baselinesCommand: CliCommand = {
  help: {
    name: "baselines",
    summary: "Manage screenshot baselines (accept new ones).",
    example: "ai-test baselines accept --run-id R-…",
    options: [{ flag: "accept", description: "Sub-subcommand: promote new screenshots" }],
  },
  run: async (args) => {
    const sub = args.positional[0];
    args.positional = args.positional.slice(1);
    if (sub === "accept") return baselinesAccept.run(args);
    process.stderr.write("Unknown baselines subcommand. Try: accept\n");
    return 1;
  },
};
