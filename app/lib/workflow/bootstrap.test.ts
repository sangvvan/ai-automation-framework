import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { writeWorkflowYaml, copySpecsFolder } from "./bootstrap";

describe("writeWorkflowYaml", () => {
  it("emits anonymous-only roles when no recipe given", async () => {
    const cwd = process.cwd();
    const tmp = mkdtempSync(path.join(os.tmpdir(), "ai-test-bs-"));
    process.chdir(tmp);
    try {
      const out = await writeWorkflowYaml({
        project: "shop",
        baseUrl: "https://shop.example.com",
      });
      expect(out).toBe(path.join("inputs", "projects", "shop.yaml"));
      const parsed = parseYaml(readFileSync(out, "utf8"));
      expect(parsed.project).toBe("shop");
      expect(parsed.roles).toHaveLength(1);
      expect(parsed.roles[0].name).toBe("anonymous");
      expect(parsed.run.nonFunctional.a11y).toBe(true);
      expect(parsed.run.suiteTag).toBe("shop");
    } finally {
      process.chdir(cwd);
    }
  });

  it("emits anonymous + authenticated roles when recipe path given", async () => {
    const cwd = process.cwd();
    const tmp = mkdtempSync(path.join(os.tmpdir(), "ai-test-bs-"));
    process.chdir(tmp);
    try {
      const out = await writeWorkflowYaml({
        project: "shop",
        baseUrl: "https://shop.example.com",
        authRecipePath: "inputs/auth/shop.yaml",
      });
      const parsed = parseYaml(readFileSync(out, "utf8"));
      expect(parsed.roles).toHaveLength(2);
      expect(parsed.roles[1].name).toBe("authenticated");
      expect(parsed.roles[1].authRecipe).toBe("inputs/auth/shop.yaml");
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("copySpecsFolder", () => {
  it("copies *.md / *.yaml recursively, skipping other files", async () => {
    const src = mkdtempSync(path.join(os.tmpdir(), "ai-test-specs-"));
    mkdirSync(path.join(src, "nested"), { recursive: true });
    writeFileSync(path.join(src, "REQ-001.md"), "# req\n");
    writeFileSync(path.join(src, "nested", "US-001.md"), "# us\n");
    writeFileSync(path.join(src, "ignore.bin"), "x");
    const dest = mkdtempSync(path.join(os.tmpdir(), "ai-test-specs-dest-"));
    const copied = await copySpecsFolder(src, dest);
    expect(copied).toBe(2);
    expect(readFileSync(path.join(dest, "REQ-001.md"), "utf8")).toContain("# req");
    expect(readFileSync(path.join(dest, "US-001.md"), "utf8")).toContain("# us");
  });
});
