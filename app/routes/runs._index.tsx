import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { requireUser } from "~/lib/auth/require-user";
import { runsRepo } from "~/lib/db/runs";
import { StatusPill } from "~/components/runs/StatusPill";

export const meta: MetaFunction = () => [
  { title: "Runs — ai-test" },
  { name: "description", content: "Recent test runs and pending scenarios for review." },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const runs = await runsRepo.listRecent(50);
  return json({ user: { name: user.name, role: user.role }, runs });
}

export default function RunsIndex() {
  const { user, runs } = useLoaderData<typeof loader>();
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Runs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Signed in as {user.name} ({user.role})
          </p>
        </div>
        <div className="flex items-center gap-4">
          {user.role === "test-lead" ? (
            <a className="text-sm text-indigo-600 hover:underline" href="/admin/users">
              User admin
            </a>
          ) : null}
          <Form method="post" action="/auth/logout">
            <button className="text-sm text-slate-500 hover:underline">Sign out</button>
          </Form>
        </div>
      </header>

      <section className="p-6">
        {runs.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full border-collapse bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-100 dark:bg-slate-800/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-3 text-sm">Run id</th>
                <th scope="col" className="px-4 py-3 text-sm">App</th>
                <th scope="col" className="px-4 py-3 text-sm">Mode</th>
                <th scope="col" className="px-4 py-3 text-sm">Totals</th>
                <th scope="col" className="px-4 py-3 text-sm">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const t = r.totals as { total: number; passed: number; failed: number; skipped: number };
                return (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3 text-sm font-mono">
                      <Link className="text-indigo-600 hover:underline" to={`/runs/${r.id}`}>
                        {r.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm truncate max-w-xs">{r.app_url ?? "—"}</td>
                    <td className="px-4 py-3 text-sm">{r.mode}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="text-emerald-600">{t.passed}</span> /{" "}
                      <span className="text-rose-600">{t.failed}</span> /{" "}
                      <span className="text-slate-500">{t.skipped}</span> · {t.total}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{r.started_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12">
      <h2 className="text-lg font-semibold">No runs yet</h2>
      <p className="text-slate-500 mt-2">
        Kick off a run from the CLI:
      </p>
      <pre className="mt-3 bg-slate-100 dark:bg-slate-800 p-3 rounded-lg inline-block text-left text-sm">
{`npm run ai-test -- run --url https://example.com --mode explore`}
      </pre>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert" className="text-center">
        <h1 className="text-xl font-semibold">Could not load runs</h1>
        <p className="text-sm text-slate-500">Database may be unavailable.</p>
      </div>
    </main>
  );
}

void StatusPill;
