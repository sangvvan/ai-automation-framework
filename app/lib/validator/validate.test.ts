import { describe, expect, it } from "vitest";
import { validateScenarioResult } from "./validate";
import type { ScenarioResult } from "../validation";

const base: ScenarioResult = {
  scenarioId: "TC",
  status: "passed",
  steps: [{ index: 0, status: "passed", durationMs: 10 }],
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:01.000Z",
  finalUrl: "https://example.com/dashboard",
  finalText: "Welcome back, Sang",
  consoleMessages: [],
};

describe("validateScenarioResult", () => {
  it("passes when URL and text match", () => {
    const v = validateScenarioResult(base, {
      url: "/dashboard",
      text: "Welcome",
    });
    expect(v.status).toBe("passed");
  });

  it("fails with reason when expected text missing", () => {
    const v = validateScenarioResult(base, { text: "Profile" });
    expect(v.status).toBe("failed");
    expect(v.failureReason).toMatch(/Profile/);
    expect(v.suggestedDefect).toBeDefined();
  });

  it("emits WARN for console errors on pass", () => {
    const v = validateScenarioResult(
      {
        ...base,
        consoleMessages: [{ level: "error", message: "TypeError x is undefined" }],
      },
      {},
    );
    expect(v.status).toBe("passed");
    expect(v.checks.some((c) => c.status === "warn")).toBe(true);
  });

  it("fails when execution failed", () => {
    const v = validateScenarioResult(
      {
        ...base,
        status: "failed",
        steps: [{ index: 0, status: "failed", durationMs: 1, reason: "timeout" }],
      },
      {},
    );
    expect(v.status).toBe("failed");
    expect(v.suggestedDefect?.severity).toBe("high");
  });
});
