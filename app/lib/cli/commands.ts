import type { CommandHelp } from "./help";
import type { ParsedArgs } from "./args";

export interface CliCommand {
  help: CommandHelp;
  run(args: ParsedArgs): Promise<number>;
}

export type CommandRegistry = Record<string, CliCommand>;
