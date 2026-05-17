import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

export interface LaunchOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  navigationTimeoutMs?: number;
  /** Optional storage-state JSON path (login state). */
  storageState?: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
  startTrace(outDir: string): Promise<void>;
  stopTrace(file: string): Promise<void>;
  close(): Promise<void>;
}

export async function launchBrowser(opts: LaunchOptions = {}): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    storageState: opts.storageState,
  });
  const page = await context.newPage();
  if (opts.navigationTimeoutMs) page.setDefaultNavigationTimeout(opts.navigationTimeoutMs);

  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  return {
    browser,
    context,
    page,
    consoleErrors,
    async startTrace() {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    },
    async stopTrace(file: string) {
      await context.tracing.stop({ path: file });
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
