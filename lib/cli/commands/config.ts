import { loadConfig } from "../../config";
import type { CliCommand } from "../commands";

export const configShowCommand: CliCommand = {
  help: {
    name: "config",
    summary: "Print the effective merged configuration.",
    example: "ai-test config show",
  },
  run: async () => {
    const cfg = loadConfig();
    process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
    return 0;
  },
};
