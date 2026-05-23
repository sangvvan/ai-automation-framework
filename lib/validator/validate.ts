import type {
  ExpectedResult,
  ScenarioResult,
  ValidationCheck,
  ValidationResult,
} from "../validation";

export function validateScenarioResult(
  result: ScenarioResult,
  expected: ExpectedResult,
): ValidationResult {
  const checks: ValidationCheck[] = [];

  // 1. Runner-level result
  if (result.status === "failed" || result.status === "error") {
    const failed = result.steps.find((s) => s.status === "failed");
    checks.push({
      name: "execution",
      status: "failed",
      detail: failed?.reason ?? "scenario did not complete",
    });
  } else if (result.status === "skipped") {
    checks.push({ name: "execution", status: "failed", detail: "scenario skipped" });
  } else {
    checks.push({ name: "execution", status: "passed" });
  }

  // 2. URL check
  if (expected.url !== undefined) {
    const actual = result.finalUrl ?? "";
    const ok = actual.includes(expected.url);
    checks.push({
      name: "url",
      status: ok ? "passed" : "failed",
      detail: ok ? undefined : `expected URL to contain "${expected.url}" but got "${actual}"`,
    });
  }

  // 3. Text check
  if (expected.text !== undefined) {
    const text = result.finalText ?? "";
    const ok = text.includes(expected.text);
    checks.push({
      name: "text",
      status: ok ? "passed" : "failed",
      detail: ok
        ? undefined
        : `expected text "${truncate(expected.text)}" not found (actual: "${truncate(text)}")`,
    });
  }

  // 4. Console errors → WARN even on pass
  if (result.consoleMessages.length > 0) {
    const msgs = result.consoleMessages
      .filter((m) => m.level === "error")
      .map((m) => m.message)
      .slice(0, 5);
    if (msgs.length) {
      checks.push({
        name: "console-errors",
        status: "warn",
        detail: msgs.join(" | "),
      });
    }
  }

  const failed = checks.find((c) => c.status === "failed");
  const status: ValidationResult["status"] = failed ? "failed" : "passed";
  const failureReason = failed?.detail;
  const validation: ValidationResult = {
    scenarioId: result.scenarioId,
    status,
    checks,
    failureReason,
  };

  if (status === "failed") {
    validation.suggestedDefect = {
      summary: `Scenario ${result.scenarioId} failed: ${failureReason ?? "see checks"}`,
      stepsToReproduce: result.steps
        .filter((s) => s.status !== "skipped")
        .map((s) => `Step ${s.index}: ${s.status}${s.reason ? ` (${s.reason})` : ""}`),
      evidenceLinks: [
        ...(result.screenshotPath ? [result.screenshotPath] : []),
        ...(result.tracePath ? [result.tracePath] : []),
      ],
      severity: failed?.name === "execution" ? "high" : "med",
    };
  }

  return validation;
}

function truncate(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
