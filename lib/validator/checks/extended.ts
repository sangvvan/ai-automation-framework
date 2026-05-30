import type { Page } from "@playwright/test";
import { resolveLocator } from "../../runner/resolver";
import type {
  AttributeAssertion,
  ChildCountAssertion,
  ExpectedResult,
  Locator,
  ValidationCheck,
} from "../../validation";

export interface ExtendedCheckInput {
  page?: Page;
  finalUrl?: string;
  finalText?: string;
  expected: ExpectedResult;
}

export async function runExtendedChecks(
  input: ExtendedCheckInput,
): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const { expected, finalUrl = "", finalText = "", page } = input;

  if (expected.urlNotContains !== undefined) {
    const ok = !finalUrl.includes(expected.urlNotContains);
    checks.push({
      name: "url-not-contains",
      status: ok ? "passed" : "failed",
      detail: ok
        ? undefined
        : `expected URL not to contain "${expected.urlNotContains}" but got "${finalUrl}"`,
      category: "functional",
    });
  }

  if (expected.textNotContains !== undefined) {
    const ok = !finalText.includes(expected.textNotContains);
    checks.push({
      name: "text-not-contains",
      status: ok ? "passed" : "failed",
      detail: ok
        ? undefined
        : `expected text not to contain "${expected.textNotContains}"`,
      category: "functional",
    });
  }

  if (expected.visibleLocators && page) {
    for (const loc of expected.visibleLocators) {
      checks.push(await visibilityCheck(page, loc, true));
    }
  }
  if (expected.notVisibleLocators && page) {
    for (const loc of expected.notVisibleLocators) {
      checks.push(await visibilityCheck(page, loc, false));
    }
  }
  if (expected.attribute && page) {
    checks.push(await attributeCheck(page, expected.attribute));
  }
  if (expected.childCount && page) {
    checks.push(await childCountCheck(page, expected.childCount));
  }

  return checks;
}

async function visibilityCheck(
  page: Page,
  loc: Locator,
  shouldBeVisible: boolean,
): Promise<ValidationCheck> {
  try {
    const pl = resolveLocator(page, loc).first();
    const isVisible = await pl.isVisible().catch(() => false);
    const ok = isVisible === shouldBeVisible;
    return {
      name: shouldBeVisible ? "visible-locator" : "not-visible-locator",
      status: ok ? "passed" : "failed",
      detail: ok
        ? undefined
        : `${describeLocator(loc)} ${shouldBeVisible ? "expected visible but was hidden" : "expected hidden but was visible"}`,
      category: "functional",
    };
  } catch (err) {
    return {
      name: shouldBeVisible ? "visible-locator" : "not-visible-locator",
      status: "failed",
      detail: (err as Error).message.slice(0, 200),
      category: "functional",
    };
  }
}

async function attributeCheck(
  page: Page,
  a: AttributeAssertion,
): Promise<ValidationCheck> {
  try {
    const pl = resolveLocator(page, a.target).first();
    const value = (await pl.getAttribute(a.name).catch(() => null)) ?? "";
    let ok = true;
    let detail: string | undefined;
    if (a.equals !== undefined) {
      ok = value === a.equals;
      if (!ok) detail = `attribute ${a.name}="${value}" ≠ expected "${a.equals}"`;
    } else if (a.contains !== undefined) {
      ok = value.includes(a.contains);
      if (!ok) detail = `attribute ${a.name}="${value}" does not contain "${a.contains}"`;
    }
    return {
      name: `attribute:${a.name}`,
      status: ok ? "passed" : "failed",
      detail,
      category: "functional",
    };
  } catch (err) {
    return {
      name: `attribute:${a.name}`,
      status: "failed",
      detail: (err as Error).message.slice(0, 200),
      category: "functional",
    };
  }
}

async function childCountCheck(
  page: Page,
  c: ChildCountAssertion,
): Promise<ValidationCheck> {
  try {
    const pl = resolveLocator(page, c.target).first();
    const count = await pl.locator(":scope > *").count();
    const minOk = c.min === undefined || count >= c.min;
    const maxOk = c.max === undefined || count <= c.max;
    const ok = minOk && maxOk;
    const detail = ok
      ? undefined
      : `child count ${count} outside [${c.min ?? "_"}, ${c.max ?? "_"}]`;
    return {
      name: "child-count",
      status: ok ? "passed" : "failed",
      detail,
      category: "functional",
    };
  } catch (err) {
    return {
      name: "child-count",
      status: "failed",
      detail: (err as Error).message.slice(0, 200),
      category: "functional",
    };
  }
}

function describeLocator(loc: Locator): string {
  switch (loc.kind) {
    case "role":
      return `role=${loc.role}${loc.name ? `[${loc.name}]` : ""}`;
    case "label":
      return `label="${loc.text}"`;
    case "text":
      return `text="${loc.text}"`;
    case "testId":
      return `testId=${loc.value}`;
    case "css":
      return `css=${loc.selector}`;
    case "xpath":
      return `xpath=${loc.selector}`;
  }
}

/**
 * Pure-function variant for unit tests — doesn't require a Page; only
 * exercises `urlNotContains` + `textNotContains`.
 */
export function runExtendedChecksPure(input: {
  finalUrl?: string;
  finalText?: string;
  expected: ExpectedResult;
}): ValidationCheck[] {
  return [
    ...(input.expected.urlNotContains !== undefined
      ? [
          {
            name: "url-not-contains",
            status:
              !(input.finalUrl ?? "").includes(input.expected.urlNotContains)
                ? ("passed" as const)
                : ("failed" as const),
            detail:
              (input.finalUrl ?? "").includes(input.expected.urlNotContains)
                ? `expected URL not to contain "${input.expected.urlNotContains}"`
                : undefined,
            category: "functional" as const,
          },
        ]
      : []),
    ...(input.expected.textNotContains !== undefined
      ? [
          {
            name: "text-not-contains",
            status:
              !(input.finalText ?? "").includes(input.expected.textNotContains)
                ? ("passed" as const)
                : ("failed" as const),
            detail:
              (input.finalText ?? "").includes(input.expected.textNotContains)
                ? `expected text not to contain "${input.expected.textNotContains}"`
                : undefined,
            category: "functional" as const,
          },
        ]
      : []),
  ];
}
