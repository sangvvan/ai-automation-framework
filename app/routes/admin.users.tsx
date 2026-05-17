import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { requireUser } from "~/lib/auth/require-user";
import { usersRepo, type UserRole } from "~/lib/db/users";
import { audit } from "~/lib/db/audit-log";

export const meta: MetaFunction = () => [
  { title: "User administration — ai-test" },
  { name: "description", content: "Manage user roles for the ai-test framework." },
];

const RoleEnum = z.enum(["viewer", "tester", "test-lead"]);

const SetRoleInput = z.object({
  userId: z.string().uuid(),
  role: RoleEnum,
});

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireUser(request, "test-lead");
  const users = await usersRepo.listAll();
  return json({
    me: { id: me.id, name: me.name, role: me.role },
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      created_at: u.created_at,
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireUser(request, "test-lead");
  const formData = await request.formData();
  const parsed = SetRoleInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  if (parsed.data.userId === me.id && parsed.data.role !== "test-lead") {
    return json(
      { fieldErrors: { role: ["You cannot demote yourself"] } },
      { status: 422 },
    );
  }
  const target = await usersRepo.findById(parsed.data.userId);
  if (!target) {
    throw new Response("User not found", { status: 404 });
  }
  await usersRepo.setRole(parsed.data.userId, parsed.data.role as UserRole);
  await audit({
    actor: me.id,
    action: "edit",
    entity: `user:${parsed.data.userId}`,
    payload: {
      prevRole: target.role,
      nextRole: parsed.data.role,
    },
  });
  return redirect("/admin/users");
}

type ActionData = { fieldErrors?: Record<string, string[] | undefined> } | undefined;

export default function AdminUsers() {
  const { me, users } = useLoaderData<typeof loader>();
  const data = useActionData<ActionData>();
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <a href="/runs" className="text-sm text-indigo-600 hover:underline">
          ← Runs
        </a>
        <h1 className="text-xl font-semibold mt-1">User administration</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Signed in as {me.name} ({me.role})
        </p>
      </header>

      <section className="p-6">
        {data?.fieldErrors?.role ? (
          <p role="alert" className="mb-3 text-rose-600 text-sm">
            {data.fieldErrors.role.join(" ")}
          </p>
        ) : null}
        <table className="w-full border-collapse bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-100 dark:bg-slate-800/50 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 text-sm">Email</th>
              <th scope="col" className="px-4 py-3 text-sm">Name</th>
              <th scope="col" className="px-4 py-3 text-sm">Role</th>
              <th scope="col" className="px-4 py-3 text-sm">Created</th>
              <th scope="col" className="px-4 py-3 text-sm">Update</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 text-sm">{u.email}</td>
                <td className="px-4 py-3 text-sm">{u.name}</td>
                <td className="px-4 py-3 text-sm">
                  <code>{u.role}</code>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{u.created_at}</td>
                <td className="px-4 py-3 text-sm">
                  <Form method="post" className="flex gap-2 items-center">
                    <input type="hidden" name="userId" value={u.id} />
                    <label className="sr-only" htmlFor={`role-${u.id}`}>
                      Role for {u.email}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      name="role"
                      defaultValue={u.role}
                      className="text-sm rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-950 px-2 py-1"
                    >
                      <option value="viewer">viewer</option>
                      <option value="tester">tester</option>
                      <option value="test-lead">test-lead</option>
                    </select>
                    <button
                      className="min-h-[36px] px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
                      type="submit"
                      disabled={u.id === me.id}
                      title={u.id === me.id ? "Cannot edit your own role" : "Save"}
                    >
                      Save
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert">Admin page unavailable.</div>
    </main>
  );
}
