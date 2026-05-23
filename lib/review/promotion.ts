import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ScenarioRow } from "../db/runs";

export interface PromotionPaths {
  approvedDir: string;
  regressionDir: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

interface FrontMatter {
  approvedBy?: string;
  approvedAt?: string;
  promotedBy?: string;
  promotedAt?: string;
  origin: string;
  runId: string;
}

function buildYaml(row: ScenarioRow, frontMatter: FrontMatter): string {
  const body = {
    id: row.id,
    title: row.title,
    type: row.type,
    priority: row.priority,
    page_url: row.page_url,
    metadata: frontMatter,
  };
  return stringifyYaml(body);
}

export async function writeApprovedScenario(
  row: ScenarioRow,
  paths: PromotionPaths,
  approver: { id: string; name: string },
): Promise<string> {
  const feature = slugify(row.title) || row.id;
  const dir = path.join(paths.approvedDir, feature);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slugify(row.id)}.yaml`);
  const yaml = buildYaml(row, {
    origin: row.origin,
    runId: row.run_id,
    approvedBy: `${approver.name} <${approver.id}>`,
    approvedAt: new Date().toISOString(),
  });
  await writeFile(file, yaml);
  return file;
}

export async function writeRegressionScenario(
  row: ScenarioRow,
  paths: PromotionPaths,
  promoter: { id: string; name: string },
): Promise<string> {
  const feature = slugify(row.title) || row.id;
  const dir = path.join(paths.regressionDir, feature);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slugify(row.id)}.yaml`);
  const yaml = buildYaml(row, {
    origin: row.origin,
    runId: row.run_id,
    promotedBy: `${promoter.name} <${promoter.id}>`,
    promotedAt: new Date().toISOString(),
  });
  await writeFile(file, yaml);
  return file;
}
