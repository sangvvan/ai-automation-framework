import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthConfigError, loadAuthRecipe } from "./recipe-loader";

function tmpFile(contents: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ai-test-auth-"));
  const file = path.join(dir, "recipe.yaml");
  writeFileSync(file, contents);
  return file;
}

const VALID_YAML = `
id: example
loginUrl: https://example.com/login
fields:
  username:
    locator: { kind: role, role: textbox, name: Email }
    value: \${TEST_EMAIL}
  password:
    locator: { kind: role, role: textbox, name: Password }
    value: \${TEST_PASSWORD}
submit:
  locator: { kind: role, role: button, name: "Sign in" }
postLogin:
  urlContains: /app
`;

describe("loadAuthRecipe", () => {
  beforeEach(() => {
    process.env.TEST_EMAIL = "ada@example.com";
    process.env.TEST_PASSWORD = "Pa55word!!";
  });
  afterEach(() => {
    delete process.env.TEST_EMAIL;
    delete process.env.TEST_PASSWORD;
  });

  it("loads and substitutes env vars", async () => {
    const file = tmpFile(VALID_YAML);
    const r = await loadAuthRecipe(file);
    expect(r.fields.username.value).toBe("ada@example.com");
    expect(r.fields.password.value).toBe("Pa55word!!");
  });

  it("throws on missing env var", async () => {
    delete process.env.TEST_EMAIL;
    const file = tmpFile(VALID_YAML);
    await expect(loadAuthRecipe(file)).rejects.toBeInstanceOf(AuthConfigError);
  });

  it("throws on invalid YAML structure", async () => {
    const file = tmpFile(`id: example\nfields: not-an-object`);
    await expect(loadAuthRecipe(file)).rejects.toBeInstanceOf(AuthConfigError);
  });
});
