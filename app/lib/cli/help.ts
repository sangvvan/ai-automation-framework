export interface CommandHelp {
  name: string;
  summary: string;
  example: string;
  options?: { flag: string; description: string; default?: string }[];
}

export function formatRootHelp(commands: CommandHelp[]): string {
  const lines = [
    "ai-test — AI-powered system test automation framework",
    "",
    "USAGE",
    "  ai-test <command> [options]",
    "",
    "COMMANDS",
  ];
  const pad = Math.max(...commands.map((c) => c.name.length));
  for (const c of commands) {
    lines.push(`  ${c.name.padEnd(pad)}  ${c.summary}`);
  }
  lines.push("", "EXAMPLES");
  for (const c of commands) lines.push(`  ${c.example}`);
  lines.push("", "Run `ai-test <command> --help` for command-specific options.");
  return lines.join("\n");
}

export function formatCommandHelp(c: CommandHelp): string {
  const lines = [`ai-test ${c.name} — ${c.summary}`, "", "USAGE", `  ${c.example}`];
  if (c.options && c.options.length) {
    lines.push("", "OPTIONS");
    const pad = Math.max(...c.options.map((o) => o.flag.length));
    for (const o of c.options) {
      const def = o.default !== undefined ? ` (default: ${o.default})` : "";
      lines.push(`  ${o.flag.padEnd(pad)}  ${o.description}${def}`);
    }
  }
  return lines.join("\n");
}
