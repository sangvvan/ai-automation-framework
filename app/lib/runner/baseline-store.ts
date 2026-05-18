import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BaselineMetadata {
  capturedAt: string;
  viewport: { width: number; height: number };
  browser: string;
  threshold: number;
}

export interface BaselinePaths {
  baselinePath: string;
  metadataPath: string;
  diffPath: string;
}

export interface LookupOptions {
  baselinesRoot: string;
  evidenceDir: string;
  suiteSlug: string;
  scenarioId: string;
  shotName: string;
}

export interface LookupResult {
  exists: boolean;
  paths: BaselinePaths;
}

export async function lookupBaseline(opts: LookupOptions): Promise<LookupResult> {
  const baselineDir = path.join(opts.baselinesRoot, opts.suiteSlug, opts.scenarioId);
  const baselinePath = path.join(baselineDir, `${opts.shotName}.png`);
  const metadataPath = path.join(baselineDir, `${opts.shotName}.metadata.json`);
  const diffPath = path.join(opts.evidenceDir, `diff-${opts.shotName}.png`);
  return {
    exists: existsSync(baselinePath),
    paths: { baselinePath, metadataPath, diffPath },
  };
}

export async function writeBaseline(
  paths: BaselinePaths,
  capturedPath: string,
  metadata: BaselineMetadata,
): Promise<void> {
  await mkdir(path.dirname(paths.baselinePath), { recursive: true });
  await copyFile(capturedPath, paths.baselinePath);
  await writeFile(paths.metadataPath, JSON.stringify(metadata, null, 2));
}

export async function readMetadata(
  metadataPath: string,
): Promise<BaselineMetadata | null> {
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as BaselineMetadata;
  } catch {
    return null;
  }
}

export interface DiffOutcome {
  pixelDeltaRatio: number;
  diffWritten: boolean;
}

/**
 * Diff two PNGs. Uses pixelmatch + pngjs when available; otherwise falls
 * back to a byte-equality short-circuit + a 1.0 ratio when they differ.
 *
 * Both libraries are optional peer deps so the framework still builds
 * when visual regression isn't needed.
 */
export async function diffScreenshots(
  baselinePath: string,
  candidatePath: string,
  diffPath: string,
  _threshold: number,
): Promise<DiffOutcome> {
  type PngLib = {
    sync: { read(b: Buffer): { width: number; height: number; data: Buffer }; write(p: unknown): Buffer };
    new (opts: { width: number; height: number }): { width: number; height: number; data: Buffer };
  };
  type Pixelmatch = (
    a: Buffer,
    b: Buffer,
    out: Buffer,
    w: number,
    h: number,
    opts?: { threshold?: number },
  ) => number;

  let pixelmatch: Pixelmatch | undefined;
  let PNG: PngLib | undefined;
  try {
    const pm = (await import("pixelmatch" as string)) as { default: Pixelmatch };
    pixelmatch = pm.default;
    const png = (await import("pngjs" as string)) as { PNG: PngLib };
    PNG = png.PNG;
  } catch {
    // Fall back: byte-equality check.
    const [a, b] = await Promise.all([readFile(baselinePath), readFile(candidatePath)]);
    if (a.equals(b)) return { pixelDeltaRatio: 0, diffWritten: false };
    await mkdir(path.dirname(diffPath), { recursive: true });
    await copyFile(candidatePath, diffPath);
    return { pixelDeltaRatio: 1, diffWritten: true };
  }

  if (!pixelmatch || !PNG) {
    return { pixelDeltaRatio: 0, diffWritten: false };
  }

  const baseline = PNG.sync.read(await readFile(baselinePath));
  const candidate = PNG.sync.read(await readFile(candidatePath));
  const width = Math.min(baseline.width, candidate.width);
  const height = Math.min(baseline.height, candidate.height);
  const diff = new PNG({ width, height });
  const deltaPx = pixelmatch(
    baseline.data,
    candidate.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );
  await mkdir(path.dirname(diffPath), { recursive: true });
  await writeFile(diffPath, PNG.sync.write(diff));
  return {
    pixelDeltaRatio: deltaPx / (width * height),
    diffWritten: true,
  };
}
