import { db } from "./client";

export type UserRole = "viewer" | "tester" | "test-lead";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  created_at: string;
}

export const usersRepo = {
  async findByEmail(email: string): Promise<UserRow | null> {
    return db.queryOne<UserRow>(
      "SELECT id, email, password_hash, name, role, created_at FROM users WHERE email = $1",
      [email],
    );
  },
  async findById(id: string): Promise<UserRow | null> {
    return db.queryOne<UserRow>(
      "SELECT id, email, password_hash, name, role, created_at FROM users WHERE id = $1",
      [id],
    );
  },
  async create(input: {
    email: string;
    passwordHash: string;
    name: string;
    role?: UserRole;
  }): Promise<UserRow> {
    const row = await db.queryOne<UserRow>(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, COALESCE($4, 'tester'))
       RETURNING id, email, password_hash, name, role, created_at`,
      [input.email, input.passwordHash, input.name, input.role ?? null],
    );
    if (!row) throw new Error("Failed to insert user");
    return row;
  },
};
