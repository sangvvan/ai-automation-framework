import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * System test config — runs the framework end-to-end against the
 * fixture sample-app with a real Playwright browser. Excluded from the
 * default `npm run test` because it requires:
 *   - Chromium installed (npx playwright install chromium)
 *   - The fixture HTTP server start-up + teardown (done by the suite)
 *
 * Run with: `npm run test:framework-system`
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["tests/systemtest/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    pool: "forks", // browser needs a real process
    fileParallelism: false,
  },
});
