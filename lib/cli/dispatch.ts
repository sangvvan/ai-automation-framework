import { parseArgs, hasHelpFlag } from "./args";
import { formatCommandHelp, formatRootHelp } from "./help";
import type { CommandRegistry } from "./commands";

export async function dispatch(
  argv: string[],
  registry: CommandRegistry,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  const [first, ...rest] = argv;
  const helps = Object.values(registry).map((c) => c.help);

  if (!first || first === "--help" || first === "-h" || first === "help") {
    io.stdout(formatRootHelp(helps) + "\n");
    return 0;
  }

  const cmd = registry[first];
  if (!cmd) {
    io.stderr(`Unknown command: ${first}\n`);
    io.stderr("Run `ai-test --help` to see available commands.\n");
    return 1;
  }

  const parsed = parseArgs(rest);
  if (hasHelpFlag(parsed)) {
    io.stdout(formatCommandHelp(cmd.help) + "\n");
    return 0;
  }

  try {
    return await cmd.run(parsed);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return 2;
  }
}
