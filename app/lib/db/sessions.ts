import { db } from "./client";

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const sessionsRepo = {
  async create(userId: string, ttlMs = ONE_WEEK_MS): Promise<SessionRow> {
    const row = await db.queryOne<SessionRow>(
      `INSERT INTO sessions (user_id, expires_at)
       VALUES ($1, $2)
       RETURNING id, user_id, expires_at, created_at`,
      [userId, new Date(Date.now() + ttlMs).toISOString()],
    );
    if (!row) throw new Error("Failed to insert session");
    return row;
  },
  async findValid(id: string): Promise<SessionRow | null> {
    return db.queryOne<SessionRow>(
      `SELECT id, user_id, expires_at, created_at FROM sessions
       WHERE id = $1 AND expires_at > now()`,
      [id],
    );
  },
  async destroy(id: string): Promise<void> {
    await db.execute("DELETE FROM sessions WHERE id = $1", [id]);
  },
};
