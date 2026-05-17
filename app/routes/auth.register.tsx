import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { usersRepo } from "~/lib/db/users";
import { sessionsRepo } from "~/lib/db/sessions";
import { hashPassword } from "~/lib/auth/passwords";
import { writeSessionId } from "~/lib/auth/session";
import { getUser } from "~/lib/auth/require-user";
import { RegisterInput } from "~/lib/validation/auth";

export const meta: MetaFunction = () => [
  { title: "Create account — ai-test" },
  { name: "description", content: "Create an ai-test account to start reviewing scenarios." },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (user) return redirect("/runs");
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const parsed = RegisterInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return json({ fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const existing = await usersRepo.findByEmail(parsed.data.email);
  if (existing) {
    return json(
      { fieldErrors: { email: ["This email is already registered"] } },
      { status: 422 },
    );
  }
  const hash = await hashPassword(parsed.data.password);
  const user = await usersRepo.create({
    email: parsed.data.email,
    name: parsed.data.name,
    passwordHash: hash,
  });
  const session = await sessionsRepo.create(user.id);
  const cookie = await writeSessionId(session.id);
  return redirect("/runs", { headers: { "Set-Cookie": cookie } });
}

type ActionData = { fieldErrors?: Record<string, string[] | undefined> } | undefined;

export default function RegisterRoute() {
  const data = useActionData<ActionData>();
  const errs = data?.fieldErrors ?? {};
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <Form
        method="post"
        className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm"
        noValidate
      >
        <h1 className="text-xl font-semibold mb-4">Create your account</h1>
        {(["name", "email", "password"] as const).map((field) => (
          <div key={field} className="mb-3">
            <label className="block text-sm font-medium mb-1 capitalize" htmlFor={field}>
              {field}
            </label>
            <input
              id={field}
              name={field}
              type={field === "password" ? "password" : field === "email" ? "email" : "text"}
              autoComplete={
                field === "password" ? "new-password" : field === "email" ? "email" : "name"
              }
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-950 px-3 py-2 focus-visible:ring-2 ring-indigo-500"
              aria-invalid={Boolean(errs[field])}
              aria-describedby={errs[field] ? `${field}-err` : undefined}
            />
            {errs[field] ? (
              <p id={`${field}-err`} role="alert" className="text-rose-600 text-sm mt-1">
                {errs[field]!.join(" ")}
              </p>
            ) : null}
          </div>
        ))}
        <button
          type="submit"
          className="mt-2 w-full min-h-[44px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium"
        >
          Create account
        </button>
        <p className="mt-3 text-sm text-slate-500">
          Have an account? <a className="text-indigo-600 hover:underline" href="/auth/login">Sign in</a>
        </p>
      </Form>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert">Registration unavailable. Try again shortly.</div>
    </main>
  );
}
