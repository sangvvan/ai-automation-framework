#!/usr/bin/env node
/**
 * AI Test Wizard — interactive wrapper around `ai-test quick`.
 * User only needs: URL, credentials (optional), provider choice.
 *
 * Usage:
 *   npm run wizard
 */
import "dotenv/config";
import readline from "node:readline";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
};
const pr = (s: string) => process.stdout.write(s);
const ln = (s = "")    => process.stdout.write(s + "\n");

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
  ln();
  ln(`${C.bold}${C.cyan}┌─────────────────────────────────────────────┐${C.reset}`);
  ln(`${C.bold}${C.cyan}│  🤖  AI Test Wizard                         │${C.reset}`);
  ln(`${C.bold}${C.cyan}│  Crawl → Generate TCs → Run → HTML Report   │${C.reset}`);
  ln(`${C.bold}${C.cyan}└─────────────────────────────────────────────┘${C.reset}`);
  ln();
}

// ─── Prompt helpers ───────────────────────────────────────────────────────────
function ask(rl: readline.Interface, label: string, defaultVal = ""): Promise<string> {
  const hint = defaultVal ? ` ${C.dim}[${defaultVal}]${C.reset}` : "";
  return new Promise(resolve =>
    rl.question(`${C.bold}  ${label}${C.reset}${hint}: `, ans => {
      resolve(ans.trim() || defaultVal);
    }),
  );
}

function askPassword(label: string): Promise<string> {
  return new Promise(resolve => {
    pr(`${C.bold}  ${label}${C.reset}: `);

    if (!process.stdin.isTTY) {
      // Non-interactive (piped input): read normally
      const rl = readline.createInterface({ input: process.stdin });
      rl.once("line", line => { rl.close(); resolve(line.trim()); });
      return;
    }

    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        ln();
        resolve(buf);
      } else if (ch === "\x03") {
        ln();
        process.exit(0);
      } else if (ch === "\x7f" || ch === "\b") {
        if (buf.length) { buf = buf.slice(0, -1); pr("\b \b"); }
      } else {
        buf += ch;
        pr("*");
      }
    };

    process.stdin.on("data", onData);
  });
}

function askMenu<T extends string>(
  rl: readline.Interface,
  label: string,
  items: { key: T; display: string }[],
  defaultIndex = 0,
): Promise<T> {
  ln(`${C.bold}  ${label}${C.reset}`);
  items.forEach(({ display }, i) => {
    const marker = i === defaultIndex ? `${C.green}▶${C.reset}` : " ";
    ln(`    ${marker} ${C.bold}${i + 1}.${C.reset} ${display}`);
  });
  return new Promise(resolve =>
    rl.question(`  ${C.dim}Enter number [default ${defaultIndex + 1}]${C.reset}: `, ans => {
      const n = parseInt(ans.trim(), 10);
      const idx = n >= 1 && n <= items.length ? n - 1 : defaultIndex;
      resolve(items[idx].key);
    }),
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.on("SIGINT", () => { rl.close(); process.exit(0); });

  // ── Step 1: URL ──────────────────────────────────────────────────────────
  ln(`${C.yellow}${C.bold}  Step 1 / 4  —  Target Website${C.reset}`);
  const url = await ask(rl, "Web URL (e.g. https://myapp.com)");
  if (!url.startsWith("http")) {
    ln(`\n${C.red}  ✗ Please enter a valid URL starting with http/https.${C.reset}`);
    rl.close(); process.exit(1);
  }
  ln();

  // ── Step 2: Auth ─────────────────────────────────────────────────────────
  ln(`${C.yellow}${C.bold}  Step 2 / 4  —  Authentication${C.reset}`);
  ln(`  ${C.dim}Leave Username blank to test as anonymous user.${C.reset}`);
  const username = await ask(rl, "Username");
  let password = "";
  if (username) {
    rl.pause();
    password = await askPassword("Password");
    rl.resume();
  }
  ln();

  // ── Step 3: AI Provider ───────────────────────────────────────────────────
  ln(`${C.yellow}${C.bold}  Step 3 / 4  —  AI Provider${C.reset}`);
  type ProviderKey = "gemini" | "claude" | "codex" | "opencode-ollama" | "lmstudio" | "mock";
  const provider = await askMenu<ProviderKey>(rl, "Choose AI provider:", [
    { key: "gemini",           display: "Gemini 2.5 Pro       — Google AI Pro  ⭐ recommended" },
    { key: "claude",           display: "Claude Sonnet 4.6    — Anthropic API" },
    { key: "codex",            display: "GPT-4o               — OpenAI API" },
    { key: "opencode-ollama",  display: "Ollama (qwen2.5:14b) — Local / offline" },
    { key: "lmstudio",         display: "LM Studio (gemma-4)  — Local / offline" },
    { key: "mock",             display: "Mock                 — No API key needed (dev/test)" },
  ], 0);
  ln();

  // ── Step 4: Crawl limits ─────────────────────────────────────────────────
  ln(`${C.yellow}${C.bold}  Step 4 / 4  —  Crawl Settings${C.reset}`);
  const maxPages = await ask(rl, "Max pages to crawl", "10");
  const maxDepth = await ask(rl, "Max crawl depth", "3");
  ln();

  rl.close();

  // ── Summary ──────────────────────────────────────────────────────────────
  ln(`${C.bold}${C.green}  ┌── Ready to run ──────────────────────────────┐${C.reset}`);
  ln(`${C.green}  │${C.reset}  URL      : ${C.bold}${url}${C.reset}`);
  ln(`${C.green}  │${C.reset}  Auth     : ${username ? `${C.bold}${username}${C.reset} / ${"*".repeat(Math.min(password.length, 8))}` : `${C.dim}anonymous${C.reset}`}`);
  ln(`${C.green}  │${C.reset}  Provider : ${C.bold}${provider}${C.reset}`);
  ln(`${C.green}  │${C.reset}  Crawl    : max ${maxPages} pages, depth ${maxDepth}`);
  ln(`${C.bold}${C.green}  └───────────────────────────────────────────────┘${C.reset}`);
  ln();
  ln(`${C.cyan}  → Launching full workflow…${C.reset}`);
  ln();

  // ── Invoke ai-test quick ─────────────────────────────────────────────────
  const scriptPath = path.resolve(__dirname, "ai-test.ts");
  const argv = [
    "vite-node", scriptPath,
    "quick",
    "--url", url,
    "--skip-preflight",
  ];
  if (username) argv.push("--username", username);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (username)           env.SITE_USERNAME  = username;
  if (password)           env.SITE_PASSWORD  = password;
  env.AI_TEST_DEFAULT_PROVIDER = provider;
  // Pass crawl limits so bootstrap can forward them via YAML
  env.WIZARD_MAX_PAGES = maxPages;
  env.WIZARD_MAX_DEPTH = maxDepth;

  const child = spawn("npx", argv, {
    env,
    stdio: "inherit",
    shell: false,
    cwd: path.resolve(__dirname, ".."),
  });

  child.on("error", err => {
    process.stderr.write(`${C.red}  ✗ Failed to start: ${err.message}${C.reset}\n`);
    process.exit(2);
  });

  child.on("exit", code => {
    ln();
    if (code === 0) {
      ln(`${C.bold}${C.green}  ✓ Done! Open reports/ to view your HTML report.${C.reset}`);
      ln(`${C.dim}  Tip: rerun failed tests with:${C.reset}`);
      ln(`${C.dim}  cd tests/generated/<project>/<role> && npx playwright test --last-failed${C.reset}`);
    } else {
      ln(`${C.bold}${C.red}  ✗ Workflow exited with code ${code}.${C.reset}`);
      ln(`${C.dim}  Check the output above for details.${C.reset}`);
    }
    ln();
    process.exit(code ?? 0);
  });
}

main().catch(err => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(2);
});
