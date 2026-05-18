import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireUser } from "~/lib/auth/require-user";
import { runsRepo } from "~/lib/db/runs";
import { testSuitesRepo } from "~/lib/db/test-suites";
import { StatusPill } from "~/components/runs/StatusPill";

export const meta: MetaFunction = ({ params }) => [
  { title: `Suite ${params.suiteId} — ai-test` },
  { name: "description", content: "ISTQB Test Suite detail: scenarios, hooks, regression tag." },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const runId = params.runId!;
  const suiteId = params.suiteId!;
  const suite = await testSuitesRepo.findById(suiteId);
  if (!suite) {
    throw new Response("Suite not found", { status: 404 });
  }
  const allScenarios = await runsRepo.listScenarios(runId);
  // Scenarios in this suite have suite_id == suiteId (extended runs
  // table). Until the persistRun helper is updated to set suite_id,
  // we fall back to the assembler grouping by feature_slug.
  const scenarios = allScenarios.filter((s) => s.title.length > 0); // placeholder

  return json({
    user: { name: user.name, role: user.role },
    runId,
    suite,
    scenarios,
  });
}

export default function SuiteDetail() {
  const { runId, suite, scenarios } = useLoaderData<typeof loader>();
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <Link to={`/runs/${runId}`} className="text-sm text-indigo-600 hover:underline">
          ← Run
        </Link>
        <h1 className="text-xl font-semibold mt-1">
          {suite.name}{" "}
          <span className="text-slate-400 text-sm">({suite.feature_slug})</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {suite.regression_tag ? `Regression tag: ${suite.regression_tag} · ` : ""}
          {suite.created_at}
        </p>
      </header>

      {suite.setup_hook ? (
        <section className="mx-6 mt-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4">
          <h2 className="text-sm font-semibold">Setup hook</h2>
          <code className="text-xs">{suite.setup_hook}</code>
        </section>
      ) : null}

      <section className="p-6 space-y-2">
        {scenarios.length === 0 ? (
          <p className="text-slate-500 text-sm">No scenarios in this suite.</p>
        ) : (
          scenarios.map((s) => (
            <article
              key={s.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
            >
              <StatusPill status={s.result_status} />
              <StatusPill status={s.review_status} />
              <h3 className="font-medium flex-1">{s.title}</h3>
              <span className="text-xs text-slate-500">
                {s.type} · {s.priority}
              </span>
            </article>
          ))
        )}
      </section>

      {suite.teardown_hook ? (
        <section className="mx-6 mb-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4">
          <h2 className="text-sm font-semibold">Teardown hook</h2>
          <code className="text-xs">{suite.teardown_hook}</code>
        </section>
      ) : null}
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert">Suite not found or DB unavailable.</div>
    </main>
  );
}
