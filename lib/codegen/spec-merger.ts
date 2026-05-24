/**
 * Spec file smart merger — two-zone strategy
 *
 * Problem: re-running generate-scripts must update tests when scenarios change,
 * but must not destroy test code that testers have added manually.
 *
 * Solution — two clearly-marked zones in every .spec.ts file:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  AUTO-GENERATED ZONE  (always refreshed by the tool)    │
 *   │  • file header (comment, imports)                       │
 *   │  • test.describe() containing generated test() blocks   │
 *   │  • each block has a sentinel with a content hash        │
 *   │    → block is updated only when its hash changes        │
 *   │    → unchanged blocks are left bit-for-bit identical    │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  CUSTOM ZONE  (never touched by the tool)               │
 *   │  • everything after the AUTO-END divider                │
 *   │  • testers add extra tests, fixtures, beforeEach, etc.  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Divider lines (written literally into the file):
 *   // ──── ai-test:auto-end ────
 *   // ──── ai-test:custom-start ────
 *
 * Individual test block sentinels inside the auto zone:
 *   // @ai-block:start id=<scenarioId> hash=<sha256[:8]>
 *   test('...', async ({ page }) => { ... });
 *   // @ai-block:end id=<scenarioId>
 *
 * On re-generation:
 *   1. The auto zone is rebuilt: header + describe-open + merged blocks +
 *      describe-close + dividers.
 *   2. Each test() block is compared by hash:
 *        same hash  → kept verbatim (zero git noise)
 *        new hash   → replaced with freshly generated code
 *        new id     → appended
 *        removed id → dropped
 *   3. The custom zone (everything after ai-test:custom-start) is
 *      preserved CHARACTER-FOR-CHARACTER, never modified.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { ExecutableScenario } from "../validation";

// ---------------------------------------------------------------------------
// Zone dividers
// ---------------------------------------------------------------------------

export const AUTO_END_MARKER   = "// ──── ai-test:auto-end ────";
export const CUSTOM_START_MARKER = "// ──── ai-test:custom-start ────";

const BLOCK_START = /^(\s*)\/\/ @ai-block:start id=(\S+) hash=([a-f0-9]+)/;
const BLOCK_END   = /^(\s*)\/\/ @ai-block:end id=(\S+)/;

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/**
 * Deterministic content hash for a scenario.
 * Changes whenever any step, action, title, priority, or expected result changes.
 */
export function scenarioHash(scenario: ExecutableScenario): string {
  const key = JSON.stringify({
    id: scenario.id,
    title: scenario.title,
    type: scenario.type,
    priority: scenario.priority,
    designTechnique: scenario.designTechnique ?? null,
    steps: scenario.steps,
    expectedResult: scenario.expectedResult,
  });
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Sentinel wrapping
// ---------------------------------------------------------------------------

export function wrapBlock(
  scenarioId: string,
  hash: string,
  blockCode: string,
  pad: string = "  ",
): string {
  return [
    `${pad}// @ai-block:start id=${scenarioId} hash=${hash}`,
    blockCode,
    `${pad}// @ai-block:end id=${scenarioId}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Parser: extract existing blocks from the auto zone
// ---------------------------------------------------------------------------

interface ParsedAutoZone {
  /** Ordered list of scenario IDs as they appear in the auto zone */
  order: string[];
  /** Map of id → { hash, fullText (including sentinels) } */
  blocks: Map<string, { hash: string; fullText: string }>;
}

function parseAutoZone(autoZoneContent: string): ParsedAutoZone {
  const lines = autoZoneContent.split("\n");
  const order: string[] = [];
  const blocks = new Map<string, { hash: string; fullText: string }>();

  let inside = false;
  let currentId = "";
  let currentHash = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const startMatch = line.match(BLOCK_START);
    const endMatch   = line.match(BLOCK_END);

    if (startMatch && !inside) {
      inside = true;
      currentId   = startMatch[2];
      currentHash = startMatch[3];
      currentLines = [line];
    } else if (endMatch && inside && endMatch[2] === currentId) {
      currentLines.push(line);
      blocks.set(currentId, {
        hash: currentHash,
        fullText: currentLines.join("\n"),
      });
      order.push(currentId);
      inside = false;
      currentLines = [];
    } else if (inside) {
      currentLines.push(line);
    }
    // Lines outside blocks (blank lines, describe wrapper, etc.) are ignored;
    // the auto zone is fully rebuilt around the merged blocks.
  }

  return { order, blocks };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeResult {
  /** Full merged spec file content */
  content: string;
  stats: {
    /** Blocks added (new scenario IDs) */
    added: number;
    /** Blocks updated (hash changed) */
    updated: number;
    /** Blocks kept unchanged (hash matched) */
    kept: number;
    /** Blocks dropped (scenario removed from YAML) */
    removed: number;
  };
}

export interface SpecParts {
  /** Static header written above the auto zone (comment + imports) */
  header: string;
  /** Opening line of the test.describe() block, e.g. `test.describe('Login', () => {` */
  describeOpen: string;
  /** Map of scenarioId → { hash, code (the test() block WITHOUT sentinels) } */
  testBlocks: Map<string, { hash: string; code: string }>;
  /** Indentation used inside describe() */
  indentSpaces: number;
}

/**
 * Merge newly generated spec parts into an existing spec file.
 *
 * @param existingContent  Current .spec.ts content (empty string = new file)
 * @param parts            Freshly generated spec parts
 */
export function mergeSpec(existingContent: string, parts: SpecParts): MergeResult {
  const stats = { added: 0, updated: 0, kept: 0, removed: 0 };
  const pad = " ".repeat(parts.indentSpaces);

  // ── Extract existing custom zone ─────────────────────────────────────────
  const customZoneContent = extractCustomZone(existingContent);

  // ── Extract existing auto zone blocks ────────────────────────────────────
  const existingAutoZone = extractAutoZone(existingContent);
  const parsed = parseAutoZone(existingAutoZone);

  // ── Merge blocks ─────────────────────────────────────────────────────────
  const mergedBlockLines: string[] = [];
  const handledIds = new Set<string>();

  // Replay existing order (preserves user's reordering inside the auto zone)
  for (const id of parsed.order) {
    const newBlock = parts.testBlocks.get(id);
    if (!newBlock) {
      stats.removed++;
      continue; // scenario deleted from YAML → drop
    }
    handledIds.add(id);

    const existing = parsed.blocks.get(id)!;
    if (existing.hash === newBlock.hash) {
      // Unchanged → keep existing text bit-for-bit
      mergedBlockLines.push(existing.fullText);
      stats.kept++;
    } else {
      // Changed → replace
      mergedBlockLines.push(wrapBlock(id, newBlock.hash, newBlock.code, pad));
      stats.updated++;
    }
    mergedBlockLines.push(""); // blank line between blocks
  }

  // Append genuinely new scenarios (not in old file)
  for (const [id, block] of parts.testBlocks) {
    if (handledIds.has(id)) continue;
    mergedBlockLines.push(wrapBlock(id, block.hash, block.code, pad));
    mergedBlockLines.push("");
    stats.added++;
  }

  // ── Assemble the auto zone ───────────────────────────────────────────────
  const autoZone = [
    parts.header,
    "",
    parts.describeOpen,
    "",
    ...mergedBlockLines,
    `});`,
    "",
    AUTO_END_MARKER,
  ].join("\n");

  // ── Assemble full file ───────────────────────────────────────────────────
  const customZone = customZoneContent ?? defaultCustomZone(parts.describeOpen);

  const content = [
    autoZone,
    "",
    CUSTOM_START_MARKER,
    customZone,
  ].join("\n");

  return { content, stats };
}

// ---------------------------------------------------------------------------
// File-level helper
// ---------------------------------------------------------------------------

export async function mergeAndWriteSpec(
  specPath: string,
  parts: SpecParts,
): Promise<MergeResult> {
  let existingContent = "";
  try {
    existingContent = await readFile(specPath, "utf8");
  } catch {
    // New file — start fresh
  }

  const result = mergeSpec(existingContent, parts);
  await writeFile(specPath, result.content, "utf8");
  return result;
}

// ---------------------------------------------------------------------------
// Zone extraction helpers
// ---------------------------------------------------------------------------

function extractAutoZone(content: string): string {
  const idx = content.indexOf(AUTO_END_MARKER);
  return idx >= 0 ? content.slice(0, idx) : content;
}

function extractCustomZone(content: string): string | null {
  const idx = content.indexOf(CUSTOM_START_MARKER);
  if (idx < 0) return null;
  // Everything after the marker line
  const afterMarker = content.slice(idx + CUSTOM_START_MARKER.length);
  return afterMarker.startsWith("\n") ? afterMarker.slice(1) : afterMarker;
}

function defaultCustomZone(describeOpen: string): string {
  // Extract describe label for the example comment
  const labelMatch = describeOpen.match(/test\.describe\('([^']+)'/);
  const label = labelMatch ? labelMatch[1] : "Page";
  return [
    `/**`,
    ` * Add your own test cases below. This section is never overwritten by ai-test.`,
    ` * You can import additional fixtures, use beforeEach/afterEach, etc.`,
    ` */`,
    ``,
    `// Example:`,
    `// test.describe('${label} — custom', () => {`,
    `//   test('my manual test', async ({ page }) => {`,
    `//     // ... your steps here`,
    `//   });`,
    `// });`,
    ``,
  ].join("\n");
}
