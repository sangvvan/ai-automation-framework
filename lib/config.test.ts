import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, _resetConfigForTests, loadConfig } from "./config";

function tmpProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ai-test-cfg-"));
  mkdirSync(path.join(dir, "configs"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

const FRAMEWORK = `
baseUrl: "http://localhost:3000"
runner:
  workers: 1
`;
const TEST_ENV = `
allowedHosts: []
`;
const AI = `
defaultProvider: mock
providers:
  mock:
    enabled: true
`;

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetConfigForTests();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("AI_TEST_")) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
  });

  it("loads merged YAML successfully", () => {
    const dir = tmpProject({
      "configs/framework.config.yaml": FRAMEWORK,
      "configs/test-env.yaml": TEST_ENV,
      "configs/ai-provider.yaml": AI,
    });
    const cfg = loadConfig({ cwd: dir, skipEnvOverride: true });
    expect(cfg.baseUrl).toBe("http://localhost:3000");
    expect(cfg.ai.defaultProvider).toBe("mock");
    expect(cfg.runner.headless).toBe(true);
  });

  it("rejects missing defaultProvider with named path", () => {
    const dir = tmpProject({
      "configs/framework.config.yaml": FRAMEWORK,
      "configs/test-env.yaml": TEST_ENV,
      "configs/ai-provider.yaml": `providers: {}`,
    });
    try {
      loadConfig({ cwd: dir, skipEnvOverride: true });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/ai\.defaultProvider/);
    }
  });

  it("env override wins over YAML", () => {
    process.env.NODE_ENV = "test";
    process.env.AI_TEST_BASE_URL = "http://override.test";
    const dir = tmpProject({
      "configs/framework.config.yaml": FRAMEWORK,
      "configs/test-env.yaml": TEST_ENV,
      "configs/ai-provider.yaml": AI,
    });
    const cfg = loadConfig({ cwd: dir });
    expect(cfg.baseUrl).toBe("http://override.test");
  });
});
