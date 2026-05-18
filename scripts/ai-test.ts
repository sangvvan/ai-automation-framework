#!/usr/bin/env node
// Entrypoint: `npm run ai-test -- <command> [options]`
import { dispatch } from "../app/lib/cli/dispatch";
import { analyzeCommand } from "../app/lib/cli/commands/analyze";
import { runCommand } from "../app/lib/cli/commands/run";
import { reportCommand } from "../app/lib/cli/commands/report";
import { configShowCommand } from "../app/lib/cli/commands/config";
import { crawlCommand } from "../app/lib/cli/commands/crawl";
import { authCommand } from "../app/lib/cli/commands/auth";
import { baselinesCommand } from "../app/lib/cli/commands/baselines";

const registry = {
  run: runCommand,
  analyze: analyzeCommand,
  crawl: crawlCommand,
  auth: authCommand,
  baselines: baselinesCommand,
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
