import { redirect } from "@remix-run/node";
import { sessionsRepo } from "../db/sessions";
import { usersRepo, type UserRole, type UserRow } from "../db/users";
import { readSessionId } from "./session";

export class AuthError extends Response {
  constructor(status: number, body: string) {
    super(body, { status });
  }
}

const ROLE_RANK: Record<UserRole, number> = {
  viewer: 0,
  tester: 1,
  "test-lead": 2,
};

export async function getUser(request: Request): Promise<UserRow | null> {
  const sid = await readSessionId(request);
  if (!sid) return null;
  const session = await sessionsRepo.findValid(sid).catch(() => null);
  if (!session) return null;
  const user = await usersRepo.findById(session.user_id).catch(() => null);
  return user;
}

export async function requireUser(
  request: Request,
  minRole: UserRole = "viewer",
): Promise<UserRow> {
  const user = await getUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
