import { randomBytes } from "node:crypto";

export function generateRunId(prefix = "R"): string {
  const now = new Date();
  const stamp =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") +
    "-" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0");
  return `${prefix}-${stamp}-${randomBytes(2).toString("hex")}`;
}
