import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { analyzePage } from "../../analyzer/analyze";
import { detectLoginForm } from "../../auth/detect-login";
import { runAuthRecipe } from "../../auth/execute-auth";

const authDetect: CliCommand = {
  help: {
    name: "auth detect",
    summary: "Analyse a login page and write a draft auth recipe.",
    example: "ai-test auth detect --url https://example.com/login",
    options: [
      { flag: "--url", description: "Login page URL (required)" },
      {
        flag: "--output",
        description: "Recipe output path",
        default: "inputs/auth/{host}.draft.yaml",
      },
    ],
  },
  run: async (args) => {
    const url = flagString(args, "url");
    if (!url) {
      process.stderr.write("Missing --url\n");
      return 1;
    }
    const cfg = loadConfig();
    const screenshotPath = path.join(cfg.evidenceDir, "auth-detect.png");
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    const analysis = await analyzePage({
      url,
      viewport: cfg.runner.viewport,
      screenshotPath,
      headless: cfg.runner.headless,
      navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
    });
    const host = new URL(url).hostname.replace(/\W+/g, "-");
    const output =
      flagString(args, "output") ?? path.join("inputs", "auth", `${host}.draft.yaml`);
    try {
      const recipe = detectLoginForm(analysis, { recipeId: host });
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, stringifyYaml(recipe));
      process.stdout.write(`✓ Draft recipe written to ${output}\n`);
      process.stdout.write(
        "Edit the file to set \${SITE_USERNAME} / \${SITE_PASSWORD} env vars, then run\n" +
          `  ai-test auth login --recipe ${output}\n`,
      );
      return 0;
    } catch (err) {
      process.stderr.write(`auth detect failed: ${(err as Error).message}\n`);
      return 3;
    }
  },
};

const authLogin: CliCommand = {
  help: {
    name: "auth login",
    summary: "Run an auth recipe and capture a storage-state file.",
    example: "ai-test auth login --recipe inputs/auth/example.yaml",
    options: [
      { flag: "--recipe", description: "Path to auth recipe YAML (required)" },
      { flag: "--output-storage", description: "Override storage-state.json path" },
      { flag: "--allow-captcha", description: "Bypass the captcha guard (boolean)" },
    ],
  },
  run: async (args) => {
    const recipePath = flagString(args, "recipe");
    if (!recipePath) {
      process.stderr.write("Missing --recipe\n");
      return 1;
    }
    try {
      const res = await runAuthRecipe({
        recipePath,
        storageStatePath: flagString(args, "output-storage"),
        allowCaptcha: flagBool(args, "allow-captcha"),
      });
      process.stdout.write(
        `✓ Logged in as recipe '${res.recipe.id}' in ${res.durationMs}ms\n`,
      );
      process.stdout.write(`Storage state: ${res.storageStatePath}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`auth login failed: ${(err as Error).message}\n`);
      return 3;
    }
  },
};

/**
 * Composite `auth` dispatcher. Reads the first positional arg as the
 * sub-subcommand (detect / login) and forwards the remaining args.
 */
export const authCommand: CliCommand = {
  help: {
    name: "auth",
    summary: "Authentication helpers (detect login form, run a recipe).",
    example: "ai-test auth detect --url … | ai-test auth login --recipe …",
    options: [
      { flag: "detect", description: "Sub-subcommand: analyse + draft a recipe" },
      { flag: "login", description: "Sub-subcommand: run a recipe + capture storage state" },
    ],
  },
  run: async (args) => {
    const sub = args.positional[0];
    args.positional = args.positional.slice(1);
    if (sub === "detect") return authDetect.run(args);
    if (sub === "login") return authLogin.run(args);
    process.stderr.write("Unknown auth subcommand. Try: detect | login\n");
    return 1;
  },
};
