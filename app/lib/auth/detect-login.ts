import type { AuthRecipe } from "../validation/auth-recipe";
import type { PageAnalysis, PageElement, Locator } from "../validation";

export class AmbiguousLoginFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousLoginFormError";
  }
}

const USERNAME_HINT_RE = /email|user(name)?|login|account/i;

/**
 * Heuristic: a login form has exactly one password input and exactly
 * one nearby text-or-email input plus a submit-like button. If the
 * page violates these constraints we abort — the operator should
 * supply a manual recipe.
 */
export function detectLoginForm(
  analysis: PageAnalysis,
  opts: { recipeId?: string; envPlaceholder?: { username: string; password: string } } = {},
): AuthRecipe {
  const visible = analysis.elements.filter((e) => e.isVisible && !e.isDisabled);

  const passwords = visible.filter(
    (e) => e.tag === "input" && (e.type === "password" || e.isSensitive),
  );
  if (passwords.length !== 1) {
    throw new AmbiguousLoginFormError(
      `Expected exactly one password input, found ${passwords.length}`,
    );
  }
  const password = passwords[0];

  // Username candidate: prefer email/text inputs whose name or accName
  // hints at username/email; fall back to any visible text input.
  const textInputs = visible.filter(
    (e) =>
      e.tag === "input" &&
      (e.type === undefined ||
        e.type === "text" ||
        e.type === "email" ||
        e.type === "tel" ||
        e.type === "search"),
  );
  const hinted = textInputs.filter((e) =>
    USERNAME_HINT_RE.test(
      `${e.accessibleName ?? ""} ${e.attributes?.["data-testid"] ?? ""}`,
    ),
  );
  let username: PageElement | undefined;
  if (hinted.length === 1) username = hinted[0];
  else if (textInputs.length === 1) username = textInputs[0];

  if (!username) {
    throw new AmbiguousLoginFormError(
      `Could not identify a single username/email input (found ${textInputs.length} text inputs, ${hinted.length} hinted)`,
    );
  }

  // Submit button — first visible button-like element.
  const submit = visible.find(
    (e) =>
      (e.tag === "button" || (e.tag === "input" && (e.type === "submit" || e.type === "button"))) &&
      !e.isDisabled,
  );
  if (!submit) {
    throw new AmbiguousLoginFormError("Could not find a submit button on the page");
  }

  const env = opts.envPlaceholder ?? {
    username: "${SITE_USERNAME}",
    password: "${SITE_PASSWORD}",
  };

  return {
    id: opts.recipeId ?? recipeIdFromUrl(analysis.url),
    loginUrl: analysis.url,
    fields: {
      username: { locator: cleanLocator(username.locator), value: env.username },
      password: { locator: cleanLocator(password.locator), value: env.password },
      extras: [],
    },
    submit: { locator: cleanLocator(submit.locator) },
    postLogin: { waitFor: [] },
    expectsCaptcha: false,
  };
}

function cleanLocator(loc: Locator): Locator {
  return loc;
}

function recipeIdFromUrl(url: string): string {
  return new URL(url).hostname.replace(/\W+/g, "-");
}
