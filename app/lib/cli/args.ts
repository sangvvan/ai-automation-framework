export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positional: string[];
}

/**
 * Lightweight argv parser: supports --flag value, --flag=value, --boolean,
 * and positional args. No external dependency.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const name = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          flags[name] = true;
        } else {
          flags[name] = next;
          i++;
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

export function flagString(p: ParsedArgs, key: string, fallback?: string): string | undefined {
  const v = p.flags[key];
  if (typeof v === "string") return v;
  return fallback;
}

export function flagBool(p: ParsedArgs, key: string, fallback = false): boolean {
  const v = p.flags[key];
  if (v === undefined) return fallback;
  if (typeof v === "boolean") return v;
  return v !== "false" && v !== "0";
}

export function hasHelpFlag(p: ParsedArgs): boolean {
  return p.flags["help"] === true || p.flags["h"] === true;
}
