import type { Page } from "@playwright/test";

export interface RunnerContext {
  page: Page;
  stepTimeoutMs: number;
  navigationTimeoutMs: number;
}
