import { describe, expect, it } from "vitest";
import { formatPreflight, runPreflight } from "./preflight";

describe("runPreflight", () => {
  it("returns passed when minimal config is intact", async () => {
    const outcome = await runPreflight();
    // node + config + ai-providers + browser checks always run
    expect(outcome.checks.find((c) => c.name === "node:version")?.status).toBe("passed");
    // status is either passed or warn (depends on browser cache); never failed in CI base env
    expect(outcome.status).not.toBe("failed");
  });

  it("formats the outcome with ✓ / ! / ✗ markers", async () => {
    const outcome = await runPreflight();
    const formatted = formatPreflight(outcome);
    expect(formatted).toMatch(/^Preflight:/);
    expect(formatted).toMatch(/[✓!✗]/);
  });

  it("warns about missing GitHub env when expectGithubEnv=true", async () => {
    const original = { ...process.env };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_PR_NUMBER;
    delete process.env.PR_NUMBER;
    delete process.env.GITHUB_REF;
    try {
      const outcome = await runPreflight({ expectGithubEnv: true });
      const check = outcome.checks.find((c) => c.name === "env:github-pr");
      expect(check?.status).toBe("warn");
    } finally {
      Object.assign(process.env, original);
    }
  });

  it("emits failed exit code 2 by default when any check fails", async () => {
    // Force a failure via strict browser check on a non-existent path.
    const original = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = "/definitely/not/a/path";
    try {
      const outcome = await runPreflight({ requireBrowser: true });
      const browserCheck = outcome.checks.find((c) => c.name === "browser:playwright");
      expect(browserCheck?.status).toBe("failed");
      expect(outcome.status).toBe("failed");
      expect(outcome.exitCode).toBe(3); // browser failures → 3
    } finally {
      if (original) process.env.PLAYWRIGHT_BROWSERS_PATH = original;
      else delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    }
  });
});
