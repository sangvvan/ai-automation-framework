import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useSearchParams } from "@remix-run/react";
import { usersRepo } from "~/lib/db/users";
import { sessionsRepo } from "~/lib/db/sessions";
import { verifyPassword } from "~/lib/auth/passwords";
import { writeSessionId } from "~/lib/auth/session";
import { getUser } from "~/lib/auth/require-user";
import { LoginInput } from "~/lib/validation/auth";

export const meta: MetaFunction = () => [
  { title: "Sign in — ai-test" },
  { name: "description", content: "Sign in to review AI-generated test scenarios." },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) return redirect("/runs");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const parsed = LoginInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const user = await usersRepo.findByEmail(parsed.data.email);
  const ok = user && (await verifyPassword(parsed.data.password, user.password_hash));
  if (!user || !ok) {
    return json(
      { fieldErrors: { email: ["Invalid email or password"] } },
      { status: 422 },
    );
  }
  const session = await sessionsRepo.create(user.id);
  const cookie = await writeSessionId(session.id);
  const next = parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/runs";
  return redirect(next, { headers: { "Set-Cookie": cookie } });
}

type ActionData = { fieldErrors?: Record<string, string[] | undefined> } | undefined;

export default function LoginRoute() {
  const data = useActionData<ActionData>();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <Form
        method="post"
        className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm"
        noValidate
      >
        <h1 className="text-xl font-semibold mb-4">Sign in to ai-test</h1>
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-950 px-3 py-2 mb-1 focus-visible:ring-2 ring-indigo-500"
          aria-invalid={Boolean(data?.fieldErrors?.email)}
          aria-describedby={data?.fieldErrors?.email ? "email-err" : undefined}
        />
        {data?.fieldErrors?.email ? (
          <p id="email-err" role="alert" className="text-rose-600 text-sm mb-3">
            {data.fieldErrors.email.join(" ")}
          </p>
        ) : null}
        <label className="block text-sm font-medium mb-1 mt-3" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-950 px-3 py-2 focus-visible:ring-2 ring-indigo-500"
        />
        <button
          type="submit"
          className="mt-5 w-full min-h-[44px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium"
        >
          Sign in
        </button>
        <p className="mt-3 text-sm text-slate-500">
          Don't have an account?{" "}
          <a className="text-indigo-600 hover:underline" href={`/auth/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
            Register
          </a>
        </p>
      </Form>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert" className="text-center">
        <h1 className="text-xl font-semibold">Sign-in unavailable</h1>
        <p className="text-sm text-slate-600">Please try again in a moment.</p>
      </div>
    </main>
  );
}
