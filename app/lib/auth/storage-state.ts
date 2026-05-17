import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";

/**
 * Capture the context's storageState (cookies + origin-scoped storage)
 * to a 0600-mode JSON file. Returns the absolute path.
 */
export async function captureStorageState(
  context: BrowserContext,
  destPath: string,
): Promise<string> {
  await mkdir(path.dirname(destPath), { recursive: true });
  const state = await context.storageState();
  await writeFile(destPath, JSON.stringify(state, null, 2));
  // Best-effort tighten permissions; on Windows this is a no-op.
  await chmod(destPath, 0o600).catch(() => undefined);
  return destPath;
}
