#!/usr/bin/env node
// Entrypoint: `npm run ai-test -- <command> [options]`
import "dotenv/config";
import { dispatch } from "../lib/cli/dispatch";
import { analyzeCommand } from "../lib/cli/commands/analyze";
import { runCommand } from "../lib/cli/commands/run";
import { reportCommand } from "../lib/cli/commands/report";
import { configShowCommand } from "../lib/cli/commands/config";
import { crawlCommand } from "../lib/cli/commands/crawl";
import { authCommand } from "../lib/cli/commands/auth";
import { baselinesCommand } from "../lib/cli/commands/baselines";
import { generateCommand } from "../lib/cli/commands/generate";
import { runSuiteCommand } from "../lib/cli/commands/run-suite";
import { regressionCommand } from "../lib/cli/commands/regression";
import { rerunCommand } from "../lib/cli/commands/rerun";
import { workflowCommand } from "../lib/cli/commands/workflow";
import { quickCommand } from "../lib/cli/commands/quick";
import { generateScriptsCommand } from "../lib/cli/commands/generate-scripts";
import { istqbTemplateCommand } from "../lib/cli/commands/istqb-template";

const registry = {
  quick: quickCommand,
  run: runCommand,
  analyze: analyzeCommand,
  crawl: crawlCommand,
  auth: authCommand,
  generate: generateCommand,
  "generate-scripts": generateScriptsCommand,
  "run-suite": runSuiteCommand,
  regression: regressionCommand,
  rerun: rerunCommand,
  workflow: workflowCommand,
  baselines: baselinesCommand,
  report: reportCommand,
  config: configShowCommand,
  "istqb-template": istqbTemplateCommand,
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
