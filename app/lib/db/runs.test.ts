import { describe, expect, it } from "vitest";
import { bareScenarioId, computeRegressionDiff, type ScenarioRow } from "./runs";

function row(id: string, status: "passed" | "failed" | "skipped", title = id): ScenarioRow {
  return {
    id,
    run_id: id.split("::")[0],
    title,
    type: "positive",
    priority: "P1",
    page_url: "https://x",
    origin: "ai-generated",
    result_status: status,
    validation: {},
    review_status: "approved",
    reviewed_by: null,
    reviewed_at: null,
    reject_reason: null,
    in_regression: false,
    spec_yaml: null,
  };
}

describe("bareScenarioId", () => {
  it("strips the run-id prefix", () => {
    expect(bareScenarioId(row("R-1::TC_LOGIN", "passed"))).toBe("TC_LOGIN");
  });
  it("returns id unchanged when no prefix", () => {
    expect(bareScenarioId(row("TC_LOGIN", "passed"))).toBe("TC_LOGIN");
  });
});

describe("computeRegressionDiff", () => {
  it("flags scenarios that newly fail vs prior run", () => {
    const prev = [row("R-1::A", "passed"), row("R-1::B", "passed")];
    const curr = [row("R-2::A", "failed"), row("R-2::B", "passed")];
    const d = computeRegressionDiff(curr, prev);
    expect(d.newFailures.map((s) => s.id)).toEqual(["A"]);
    expect(d.newlyPassing).toHaveLength(0);
    expect(d.carriedFailures).toHaveLength(0);
  });

  it("flags newly passing scenarios", () => {
    const prev = [row("R-1::A", "failed")];
    const curr = [row("R-2::A", "passed")];
    const d = computeRegressionDiff(curr, prev);
    expect(d.newlyPassing.map((s) => s.id)).toEqual(["A"]);
  });

  it("tracks carried failures (failing in both runs)", () => {
    const prev = [row("R-1::A", "failed")];
    const curr = [row("R-2::A", "failed")];
    const d = computeRegressionDiff(curr, prev);
    expect(d.carriedFailures.map((s) => s.id)).toEqual(["A"]);
    expect(d.newFailures).toHaveLength(0);
  });

  it("treats new scenarios that fail as new failures", () => {
    const prev: ScenarioRow[] = [];
    const curr = [row("R-2::A", "failed")];
    const d = computeRegressionDiff(curr, prev);
    expect(d.newFailures.map((s) => s.id)).toEqual(["A"]);
  });
});
