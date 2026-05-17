import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { requireUser } from "~/lib/auth/require-user";
import { runsRepo, computeRegressionDiff, type RegressionDiff } from "~/lib/db/runs";
import { StatusPill } from "~/components/runs/StatusPill";

export const meta: MetaFunction = ({ params }) => [
  { title: `Run ${params.runId} — ai-test` },
  { name: "description", content: "Run detail and scenario review." },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const runId = params.runId!;
  const run = await runsRepo.findById(runId);
  if (!run) {
    throw new Response("Run not found", { status: 404 });
  }
  const scenarios = await runsRepo.listScenarios(runId);

  let diff: (RegressionDiff & { previousRunId: string }) | null = null;
  if (run.suite_tag) {
    const previous = await runsRepo.findPreviousBySuiteTag(run);
    if (previous) {
      const prevScenarios = await runsRepo.listScenarios(previous.id);
      const d = computeRegressionDiff(scenarios, prevScenarios);
      if (d.newFailures.length || d.newlyPassing.length || d.carriedFailures.length) {
        diff = { ...d, previousRunId: previous.id };
      }
    }
  }

  return json({
    user: { name: user.name, role: user.role },
    run,
    scenarios,
    diff,
  });
}

export default function RunDetail() {
  const { user, run, scenarios, diff } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const filtered = scenarios.filter((s) => {
    if (filter === "all") return true;
    if (["pending_review", "approved", "rejected"].includes(filter))
      return s.review_status === filter;
    if (["passed", "failed", "skipped"].includes(filter))
      return s.result_status === filter;
    return true;
  });
  const t = run.totals as { total: number; passed: number; failed: number; skipped: number };

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <Link to="/runs" className="text-sm text-indigo-600 hover:underline">← Runs</Link>
        <h1 className="text-xl font-semibold mt-1 font-mono">{run.id}</h1>
        <p className="text-sm text-slate-500">
          {run.mode} · {run.app_url ?? "—"} · {run.started_at}
        </p>
      </header>

      {diff ? (
        <section
          role="region"
          aria-label="Regression diff"
          className="mx-6 mt-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4"
        >
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Regression diff vs{" "}
            <Link className="underline" to={`/runs/${diff.previousRunId}`}>
              {diff.previousRunId}
            </Link>
          </h2>
          <p className="text-sm text-amber-900 dark:text-amber-200 mt-1">
            +{diff.newFailures.length} new failures · +{diff.newlyPassing.length} newly
            passing · {diff.carriedFailures.length} carried failures
          </p>
          {diff.newFailures.length ? (
            <details className="mt-2" open>
              <summary className="cursor-pointer text-sm">
                New failures ({diff.newFailures.length})
              </summary>
              <ul className="mt-1 text-sm list-disc pl-5">
                {diff.newFailures.map((s) => (
                  <li key={s.id}>
                    <code>{s.id}</code> — {s.title}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {diff.newlyPassing.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm">
                Newly passing ({diff.newlyPassing.length})
              </summary>
              <ul className="mt-1 text-sm list-disc pl-5">
                {diff.newlyPassing.map((s) => (
                  <li key={s.id}>
                    <code>{s.id}</code> — {s.title}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-4 gap-3 p-6">
        {[
          { label: "Total", value: t.total, cls: "" },
          { label: "Passed", value: t.passed, cls: "border-emerald-500" },
          { label: "Failed", value: t.failed, cls: "border-rose-500" },
          { label: "Skipped", value: t.skipped, cls: "border-slate-400" },
        ].map((k) => (
          <div
            key={k.label}
            className={`bg-white dark:bg-slate-900 border-l-4 border-slate-200 dark:border-slate-700 ${k.cls} rounded-xl p-4 border border-slate-200 dark:border-slate-800`}
          >
            <div className="text-2xl font-semibold">{k.value}</div>
            <div className="text-sm text-slate-500">{k.label}</div>
          </div>
        ))}
      </section>

      <section className="px-6 pb-2 flex flex-wrap gap-2">
        {["all", "pending_review", "approved", "rejected", "passed", "failed"].map((f) => (
          <button
            key={f}
            onClick={() => setParams({ filter: f })}
            className={`text-sm px-3 py-1 rounded-full border ${
              filter === f
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
            }`}
          >
            {f}
          </button>
        ))}
      </section>

      <section className="p-6 space-y-3">
        {filtered.map((s) => {
          const canAct = user.role === "tester" || user.role === "test-lead";
          const isLead = user.role === "test-lead";
          return (
            <article
              key={s.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
            >
              <header className="flex items-center gap-3 flex-wrap">
                <StatusPill status={s.result_status} />
                <StatusPill status={s.review_status} />
                <h2 className="font-medium flex-1">{s.title}</h2>
                <span className="text-xs text-slate-500">
                  {s.type} · {s.priority} · {s.origin}
                </span>
              </header>
              {canAct && s.review_status === "pending_review" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Form
                    method="post"
                    action={`/runs/${run.id}/scenarios/${encodeURIComponent(s.id)}/approve`}
                    className="inline"
                  >
                    <button
                      aria-label={`Approve scenario: ${s.title}`}
                      className="min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                    >
                      Approve
                    </button>
                  </Form>
                  <Form
                    method="post"
                    action={`/runs/${run.id}/scenarios/${encodeURIComponent(s.id)}/reject`}
                    className="inline-flex items-center gap-2"
                  >
                    <input
                      name="reason"
                      placeholder="Rejection reason (≥10 chars)"
                      minLength={10}
                      className="text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-950"
                      required
                    />
                    <button className="min-h-[36px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm">
                      Reject
                    </button>
                  </Form>
                </div>
              ) : null}
              {s.review_status === "approved" && !s.in_regression ? (
                <Form
                  method="post"
                  action={`/runs/${run.id}/scenarios/${encodeURIComponent(s.id)}/promote`}
                  className="mt-3"
                >
                  <button
                    disabled={!isLead}
                    title={isLead ? "Promote to regression suite" : "Test Lead role required"}
                    className={`min-h-[36px] px-3 rounded-lg text-sm ${
                      isLead
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                        : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                  >
                    Promote to regression
                  </button>
                </Form>
              ) : null}
              {s.in_regression ? (
                <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                  ✓ In regression suite
                </p>
              ) : null}
              {s.reject_reason ? (
                <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">
                  Rejected: {s.reject_reason}
                </p>
              ) : null}
            </article>
          );
        })}
        {filtered.length === 0 ? (
          <p className="text-slate-500 text-sm">No scenarios match this filter.</p>
        ) : null}
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert">Run not found or unavailable.</div>
    </main>
  );
}
