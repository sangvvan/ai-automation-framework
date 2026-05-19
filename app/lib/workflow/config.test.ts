import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkflowInput, safePathSegment } from "./config";

describe("workflow input", () => {
  it("accepts a minimal project workflow and defaults role/output settings", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ai-workflow-"));
    const file = path.join(dir, "workflow.yaml");
    writeFileSync(
      file,
      `
project: Demo App
baseUrl: https://example.com
`,
      "utf8",
    );

    const input = await readWorkflowInput(file);
    expect(input.project).toBe("Demo App");
    expect(input.roles).toEqual([{ name: "default", allowCaptcha: false }]);
    expect(input.generation.outputDir).toBe("tests/generated");
  });

  it("normalizes unsafe names for artifact paths", () => {
    expect(safePathSegment("Admin / QA Lead")).toBe("admin-qa-lead");
  });
});
