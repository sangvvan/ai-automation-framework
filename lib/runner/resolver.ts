import type { Locator as PlaywrightLocator, Page } from "@playwright/test";
import type { Locator } from "../validation";

/**
 * Resolve a framework Locator to a Playwright locator using the documented
 * priority: role(name) → label → text → testId. This module is the ONLY
 * place permitted to construct Playwright locators (ADR-005).
 */
export function resolveLocator(page: Page, loc: Locator): PlaywrightLocator {
  switch (loc.kind) {
    case "role":
      return page.getByRole(loc.role, loc.name ? { name: loc.name, exact: false } : {});
    case "label":
      return page.getByLabel(loc.text, { exact: false });
    case "text":
      return page.getByText(loc.text, { exact: false });
    case "testId":
      return page.getByTestId(loc.value);
  }
}
