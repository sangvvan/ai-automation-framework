/** Minimal lint config for SDLC-pipeline output. */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  env: { browser: true, node: true, es2022: true },
  ignorePatterns: [
    "node_modules/",
    "build/",
    "dist/",
    ".cache/",
    "coverage/",
    "reports/",
    "tests/fixtures/sample-app/",
    "playwright-report/",
    "test-results/",
  ],
  rules: {
    "no-undef": "off",
  },
};
