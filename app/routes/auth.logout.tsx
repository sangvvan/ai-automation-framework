import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { readSessionId, clearSession } from "~/lib/auth/session";
import { sessionsRepo } from "~/lib/db/sessions";

export async function action({ request }: ActionFunctionArgs) {
  const sid = await readSessionId(request);
  if (sid) await sessionsRepo.destroy(sid).catch(() => undefined);
  const cookie = await clearSession();
  return redirect("/auth/login", { headers: { "Set-Cookie": cookie } });
}

export async function loader() {
  return redirect("/auth/login");
}
