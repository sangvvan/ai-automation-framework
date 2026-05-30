import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export type BrowserName = "chromium" | "firefox" | "webkit";

export interface LaunchOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  navigationTimeoutMs?: number;
  /** Optional storage-state JSON path (login state). */
  storageState?: string;
  /** Which Playwright browser to launch (REQ-013). Defaults to chromium. */
  browser?: BrowserName;
  /** BCP-47 locale tag, e.g. 'en', 'vi', 'ja' (REQ-013). */
  locale?: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  browserName: BrowserName;
  locale: string | undefined;
  consoleErrors: string[];
  startTrace(outDir: string): Promise<void>;
  stopTrace(file: string): Promise<void>;
  close(): Promise<void>;
}

const ENGINES = { chromium, firefox, webkit } as const;

export async function launchBrowser(opts: LaunchOptions = {}): Promise<BrowserSession> {
  const browserName: BrowserName = opts.browser ?? (process.env.PLAYWRIGHT_BROWSER as BrowserName) ?? "chromium";
  const engine = ENGINES[browserName];
  // Allow pointing Chromium at a system/custom binary (e.g. a distro Chrome,
  // or a cached Playwright build) via PLAYWRIGHT_CHROMIUM_EXECUTABLE. Useful
  // in locked-down CI where the matching Playwright browser revision cannot
  // be downloaded. Only honoured for the chromium engine.
  const chromiumExecutable =
    browserName === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE : undefined;
  const browser = await engine.launch({
    headless: opts.headless ?? true,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  });
  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    storageState: opts.storageState,
  };
  if (opts.locale) contextOptions.locale = opts.locale;
  const context = await browser.newContext(contextOptions);
  if (opts.locale) {
    await context.setExtraHTTPHeaders({ "accept-language": opts.locale });
  }

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
    browserName,
    locale: opts.locale,
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
