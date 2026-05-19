#!/usr/bin/env node
// Entrypoint: `npm run ai-test -- <command> [options]`
import { dispatch } from "../app/lib/cli/dispatch";
import { analyzeCommand } from "../app/lib/cli/commands/analyze";
import { runCommand } from "../app/lib/cli/commands/run";
import { reportCommand } from "../app/lib/cli/commands/report";
import { configShowCommand } from "../app/lib/cli/commands/config";
import { crawlCommand } from "../app/lib/cli/commands/crawl";
import { authCommand } from "../app/lib/cli/commands/auth";
import { generateCommand } from "../app/lib/cli/commands/generate";
import { runSuiteCommand } from "../app/lib/cli/commands/run-suite";
import { workflowCommand } from "../app/lib/cli/commands/workflow";

const registry = {
  run: runCommand,
  analyze: analyzeCommand,
  crawl: crawlCommand,
  auth: authCommand,
  generate: generateCommand,
  "run-suite": runSuiteCommand,
  workflow: workflowCommand,
  report: reportCommand,
  config: configShowCommand,
};

const io = {
  stdout: (s: string) => process.stdout.write(s),
  stderr: (s: string) => process.stderr.write(s),
};

dispatch(process.argv.slice(2), registry, io).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(2);
  },
);
