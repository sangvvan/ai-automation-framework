import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { AuthRecipe } from "../validation/auth-recipe";

export class AuthConfigError extends Error {
  constructor(
    message: string,
    readonly recipePath?: string,
  ) {
    super(message);
    this.name = "AuthConfigError";
  }
}

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Recursively walks the parsed YAML, substituting `${ENV_VAR}` tokens
 * with values from `process.env`. A missing env var throws — recipes
 * must be deterministic at load time so the operator catches typos
 * before any browser action runs.
 */
function substituteEnv<T>(value: T, recipePath: string): T {
  if (typeof value === "string") {
    return value.replace(ENV_REF, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined || v === "") {
        throw new AuthConfigError(
          `Auth recipe references missing env var: \${${name}}`,
          recipePath,
        );
      }
      return v;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteEnv(v, recipePath)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteEnv(v, recipePath);
    }
    return out as unknown as T;
  }
  return value;
}

export async function loadAuthRecipe(recipePath: string): Promise<AuthRecipe> {
  let raw: string;
  try {
    raw = await readFile(recipePath, "utf8");
  } catch (err) {
    throw new AuthConfigError(
      `Cannot read auth recipe: ${(err as Error).message}`,
      recipePath,
    );
  }
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new AuthConfigError(
      `Failed to parse YAML: ${(err as Error).message}`,
      recipePath,
    );
  }
  data = substituteEnv(data, recipePath);
  const parsed = AuthRecipe.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AuthConfigError(`Invalid auth recipe — ${issues}`, recipePath);
  }
  return parsed.data;
}
