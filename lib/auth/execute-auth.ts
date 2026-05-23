import path from "node:path";
import { launchBrowser } from "../browser/launcher";
import { resolveLocator } from "../runner/resolver";
import { loadAuthRecipe } from "./recipe-loader";
import { captureStorageState } from "./storage-state";
import type { AuthRecipe } from "../validation/auth-recipe";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export interface RunAuthRecipeOptions {
  recipePath: string;
  /** Override the storageState destination; default puts it under reports/. */
  storageStatePath?: string;
  /** Captcha-aware recipes hard-stop unless this is set. */
  allowCaptcha?: boolean;
}

export interface RunAuthRecipeResult {
  recipe: AuthRecipe;
  storageStatePath: string;
  durationMs: number;
}

export async function runAuthRecipe(
  opts: RunAuthRecipeOptions,
): Promise<RunAuthRecipeResult> {
  const started = Date.now();
  const recipe = await loadAuthRecipe(opts.recipePath);
  if (recipe.expectsCaptcha && !opts.allowCaptcha) {
    throw new AuthError(
      `Recipe '${recipe.id}' declares expectsCaptcha=true — aborting (provide --allow-captcha to bypass).`,
    );
  }
  const dest =
    opts.storageStatePath ??
    path.join("reports", "auth", `${recipe.id}-storage-state.json`);

  const session = await launchBrowser({
    headless: true,
    viewport: { width: 1280, height: 800 },
    navigationTimeoutMs: 30_000,
  });

  try {
    const page = session.page;
    await page.goto(recipe.loginUrl, { waitUntil: "domcontentloaded" });
    await resolveLocator(page, recipe.fields.username.locator)
      .first()
      .fill(recipe.fields.username.value);
    await resolveLocator(page, recipe.fields.password.locator)
      .first()
      .fill(recipe.fields.password.value);
    for (const extra of recipe.fields.extras) {
      await resolveLocator(page, extra.locator).first().fill(extra.value);
    }
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined),
      resolveLocator(page, recipe.submit.locator).first().click({ timeout: 10_000 }),
    ]);

    // Post-login verification
    if (recipe.postLogin.urlContains) {
      if (!page.url().includes(recipe.postLogin.urlContains)) {
        throw new AuthError(
          `Post-login URL check failed (expected to contain "${recipe.postLogin.urlContains}", got "${page.url()}")`,
        );
      }
    }
    for (const waitLoc of recipe.postLogin.waitFor) {
      await resolveLocator(page, waitLoc)
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => {
          throw new AuthError(
            `Post-login waitFor locator not visible: ${JSON.stringify(waitLoc)}`,
          );
        });
    }
    if (recipe.postLogin.textContains) {
      const body = await page.locator("body").innerText().catch(() => "");
      if (!body.includes(recipe.postLogin.textContains)) {
        throw new AuthError(
          `Post-login text check failed (expected to contain "${recipe.postLogin.textContains}")`,
        );
      }
    }

    const storageStatePath = await captureStorageState(session.context, dest);
    return { recipe, storageStatePath, durationMs: Date.now() - started };
  } finally {
    await session.close();
  }
}
