import type { PoolClient } from "pg";
import { db } from "./client";

export interface AuditEntry {
  actor: string | null;
  action: "approve" | "reject" | "promote" | "edit";
  entity: string;
  payload: Record<string, unknown>;
}

export async function audit(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const sql = `INSERT INTO audit_log (actor, action, entity, payload) VALUES ($1,$2,$3,$4)`;
  const params = [entry.actor, entry.action, entry.entity, JSON.stringify(entry.payload)];
  if (client) await client.query(sql, params);
  else await db.execute(sql, params);
}
