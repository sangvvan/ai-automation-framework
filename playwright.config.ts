import { defineConfig, devices } from "@playwright/test";

const env = {
  NODE_ENV: "development",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app_dev",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-chars",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "test-google-client",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "test-google-secret",
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:3000/auth/google/callback",
  GOOGLE_WORKSPACE_DOMAIN: process.env.GOOGLE_WORKSPACE_DOMAIN ?? "example.com",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  S3_BUCKET: process.env.S3_BUCKET ?? "app-uploads",
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "test-access-key",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "test-secret-key",
  S3_REGION: process.env.S3_REGION ?? "eu-west-1",
  S3_PUBLIC_URL: process.env.S3_PUBLIC_URL ?? "http://localhost:9000/app-uploads",
  SES_FROM_ADDRESS: process.env.SES_FROM_ADDRESS ?? "people@example.com",
  AWS_REGION: process.env.AWS_REGION ?? "eu-west-1",
  BASE_URL: process.env.BASE_URL ?? "http://localhost:3000",
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }], ["line"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env,
  },
});
