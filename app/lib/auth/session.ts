import { createCookie } from "@remix-run/node";
import { getEnv } from "../config";

let _cookie: ReturnType<typeof createCookie> | null = null;

function sessionCookie() {
  if (_cookie) return _cookie;
  const secret = getEnv().SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not configured");
  _cookie = createCookie("__ai_test_session", {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    secrets: [secret],
    maxAge: 60 * 60 * 24 * 7,
  });
  return _cookie;
}

export async function readSessionId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get("Cookie");
  const value = (await sessionCookie().parse(cookieHeader)) as
    | { sid?: string }
    | null;
  return value?.sid ?? null;
}

export async function writeSessionId(sid: string): Promise<string> {
  return sessionCookie().serialize({ sid });
}

export async function clearSession(): Promise<string> {
  return sessionCookie().serialize("", { maxAge: 0 });
}
