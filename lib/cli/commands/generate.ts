import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { generateTestCasesFromSiteMap } from "../../workflow/generate";

export const generateCommand: CliCommand = {
  help: {
    name: "generate",
    summary: "Generate YAML test cases from a SiteMap.",
    example:
      "ai-test generate --site-map reports/sitemaps/C-...json --project my-app --role admin",
    options: [
      { flag: "--site-map", description: "Path to SiteMap JSON (required)" },
      { flag: "--project", description: "Project label", default: "default" },
      { flag: "--role", description: "Role label", default: "default" },
      { flag: "--output-dir", description: "Output test-case directory" },
      { flag: "--storage-state", description: "Storage-state JSON for authenticated pages" },
      { flag: "--max-scenarios", description: "Max scenarios per page" },
      { flag: "--categories", description: "Comma-separated generation categories" },
      { flag: "--fallback-smoke", description: "Use smoke YAML if AI generation fails", default: "true" },
    ],
  },
  run: async (args) => {
    const siteMapPath = flagString(args, "site-map");
    if (!siteMapPath) {
      process.stderr.write("Missing --site-map\n");
      return 1;
    }

    const cfg = loadConfig();
    const result = await generateTestCasesFromSiteMap({
      siteMapPath,
      cfg,
      project: flagString(args, "project", "default") ?? "default",
      role: flagString(args, "role", "default") ?? "default",
      outputDir: flagString(args, "output-dir"),
      storageStatePath: flagString(args, "storage-state"),
      maxScenariosPerPage: numOpt(flagString(args, "max-scenarios")),
      categories: csvOpt(flagString(args, "categories")),
      fallbackSmoke: flagBool(args, "fallback-smoke", true),
    });

    process.stdout.write(
      `✓ Generated ${result.files.length} test-case file(s) in ${result.casesDir}\n`,
    );
    process.stdout.write(`Manifest: ${result.manifestPath}\n`);
    if (result.errors.length) {
      process.stderr.write(`Skipped ${result.errors.length} page(s) during generation\n`);
      return result.files.length ? 0 : 2;
    }
    return 0;
  },
};

function numOpt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function csvOpt(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
