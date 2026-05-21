import { spawn } from "node:child_process";
import path from "node:path";
import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import { bootstrap } from "../../workflow/bootstrap";
import { runPreflight, formatPreflight } from "../preflight";
import type { CliCommand } from "../commands";

/**
 * One-shot wrapper: URL + (optional) credentials + (optional) specs
 * folder → bootstrap recipe / workflow YAML / specs → invoke the
 * existing `ai-test workflow` engine → emit specs + test suite + test
 * cases + report.
 *
 * Usage:
 *   ai-test quick --url https://app.example.com
 *   ai-test quick --url https://app.example.com \
 *     --username "$SITE_USERNAME" --password "$SITE_PASSWORD"
 *   ai-test quick --url https://app.example.com --specs ./docs/specs/
 *   ai-test quick --url https://app.example.com --auto-specs
 */
export const quickCommand: CliCommand = {
  help: {
    name: "quick",
    summary:
      "One-shot: URL (+ creds + specs) → recipe + workflow YAML + specs → run full pipeline.",
    example: "ai-test quick --url https://app.example.com --username user --password '****'",
    options: [
      { flag: "--url", description: "Web app entry URL (required)" },
      { flag: "--username", description: "Login username; sets SITE_USERNAME for the run" },
      { flag: "--password", description: "Login password; sets SITE_PASSWORD for the run" },
      { flag: "--project", description: "Project slug; defaults to URL hostname" },
      { flag: "--specs", description: "Existing specs folder to copy to docs/requirements/" },
      { flag: "--auto-specs", description: "Use AI to draft a PS spec from the entry page" },
      { flag: "--skip-run", description: "Bootstrap files only; don't invoke workflow" },
      { flag: "--skip-preflight", description: "Skip P0 environment checks" },
    ],
  },
  run: async (args) => {
    const url = flagString(args, "url");
    if (!url) {
      process.stderr.write("Missing --url\n");
      return 1;
    }

    // P0 preflight first so the user knows up-front if anything will
    // block downstream (browser missing, providers misconfigured, etc).
    if (!flagBool(args, "skip-preflight")) {
      const preflight = await runPreflight({
        requireBrowser: true,
        expectGithubEnv: false,
        pingDatabase: true,
      });
      process.stdout.write(formatPreflight(preflight) + "\n");
      if (preflight.status === "failed") return preflight.exitCode;
    }

    const cfg = loadConfig();
    const username = flagString(args, "username");
    const password = flagString(args, "password");
    const specsDir = flagString(args, "specs");
    const autoSpecs = flagBool(args, "auto-specs");

    process.stdout.write(`\nBootstrapping for ${url}\n`);
    const bs = await bootstrap({
      url,
      project: flagString(args, "project"),
      username,
      password,
      specsDir,
      autoGenerateSpecs: autoSpecs,
      cfg,
    });
    for (const n of bs.notes) process.stdout.write(`  • ${n}\n`);
    process.stdout.write(
      `\nResolved project='${bs.project}' baseUrl='${bs.baseUrl}'\n` +
        `Workflow YAML: ${bs.workflowYamlPath}\n` +
        (bs.authRecipePath ? `Auth recipe:   ${bs.authRecipePath}\n` : "") +
        (bs.generatedSpecsPath ? `Spec draft:    ${bs.generatedSpecsPath}\n` : ""),
    );

    if (flagBool(args, "skip-run")) {
      process.stdout.write(
        `\n--skip-run set; review the files above then call:\n` +
          `  npm run ai-test -- workflow --input ${bs.workflowYamlPath}\n`,
      );
      return 0;
    }

    // Run the existing workflow engine in-process by spawning the same
    // node entrypoint. This keeps the wrapper a thin shell — the
    // workflow command remains the single source of truth for the
    // pipeline. We pass through credentials via env so the auth recipe
    // can substitute ${SITE_USERNAME} / ${SITE_PASSWORD}.
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (username) env.SITE_USERNAME = username;
    if (password) env.SITE_PASSWORD = password;
    const exitCode = await invokeWorkflow(bs.workflowYamlPath, env);
    return exitCode;
  },
};

function invokeWorkflow(yamlPath: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["vite-node", path.resolve("scripts/ai-test.ts"), "workflow", "--input", yamlPath],
      {
        env,
        stdio: "inherit",
        shell: false,
      },
    );
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(2));
  });
}
