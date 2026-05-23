import pg from "pg";
import { getEnv } from "../config";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });
  }
  return pool;
}

export const db = {
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const result = await getPool().query<T>(sql, params);
    return result.rows;
  },

  async queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T | null> {
    const rows = await db.query<T>(sql, params);
    return rows[0] ?? null;
  },

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await getPool().query(sql, params);
  },

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async end(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};
