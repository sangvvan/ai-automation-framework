import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { requireUser } from "~/lib/auth/require-user";
import { defectsRepo } from "~/lib/db/defects";
import { audit } from "~/lib/db/audit-log";

export const meta: MetaFunction = ({ params }) => [
  { title: `Defects ${params.runId} — ai-test` },
  { name: "description", content: "AI-suggested defects from this run." },
];

const StatusEnum = z.enum(["open", "triaged", "fixed", "wont-fix"]);
const UpdateInput = z.object({
  defectId: z.string().uuid(),
  status: StatusEnum.optional(),
  externalRef: z.string().max(500).optional(),
});

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const raw = await defectsRepo.listByRun(params.runId!).catch(() => []);
  // Cast away the `| null` that DB driver typing introduces on individual rows.
  const defects = raw.filter((d): d is NonNullable<typeof d> => d !== null);
  return json({ user: { name: user.name, role: user.role }, runId: params.runId!, defects });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request, "tester");
  const formData = await request.formData();
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return json({ fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  if (parsed.data.status) {
    await defectsRepo.updateStatus(parsed.data.defectId, parsed.data.status);
    await audit({
      actor: user.id,
      action: "edit",
      entity: `defect:${parsed.data.defectId}`,
      payload: { runId: params.runId, newStatus: parsed.data.status },
    });
  }
  if (parsed.data.externalRef !== undefined) {
    await defectsRepo.setExternalRef(
      parsed.data.defectId,
      parsed.data.externalRef || null,
    );
    await audit({
      actor: user.id,
      action: "edit",
      entity: `defect:${parsed.data.defectId}`,
      payload: { runId: params.runId, externalRef: parsed.data.externalRef },
    });
  }
  return redirect(`/runs/${params.runId}/defects`);
}

export default function DefectsList() {
  const { user, runId, defects } = useLoaderData<typeof loader>();
  const counts = countByStatus(defects);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <Link to={`/runs/${runId}`} className="text-sm text-indigo-600 hover:underline">
          ← Run {runId}
        </Link>
        <h1 className="text-xl font-semibold mt-1">
          Defects — {counts.open} open
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {counts.open} open · {counts.triaged} triaged · {counts.fixed} fixed ·{" "}
          {counts["wont-fix"]} won't-fix
        </p>
      </header>

      <section className="p-6">
        {defects.length === 0 ? (
          <div className="text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12">
            <p className="text-emerald-700 dark:text-emerald-300">
              ✓ No suggested defects from this run — nice.
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800/50 text-left">
              <tr>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2">Scenario</th>
                <th className="px-3 py-2">External ref</th>
                <th className="px-3 py-2">Update</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="px-3 py-3">
                    <SeverityPill severity={d.severity} />
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill status={d.status} />
                  </td>
                  <td className="px-3 py-3 max-w-md">{d.summary}</td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {d.scenario_id ?? "—"}
                  </td>
                  <td className="px-3 py-3 max-w-xs">
                    {d.external_ref ? (
                      <a
                        href={d.external_ref}
                        className="text-indigo-600 hover:underline break-words"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {d.external_ref}
                      </a>
                    ) : (
                      <em className="text-slate-400">—</em>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {user.role !== "viewer" ? (
                      <Form method="post" className="flex flex-col gap-2">
                        <input type="hidden" name="defectId" value={d.id} />
                        <select
                          name="status"
                          defaultValue={d.status}
                          className="text-xs rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-950 px-2 py-1"
                        >
                          <option value="open">open</option>
                          <option value="triaged">triaged</option>
                          <option value="fixed">fixed</option>
                          <option value="wont-fix">wont-fix</option>
                        </select>
                        <input
                          name="externalRef"
                          placeholder="External ref URL"
                          defaultValue={d.external_ref ?? ""}
                          className="text-xs rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-950 px-2 py-1"
                        />
                        <button className="text-xs min-h-[28px] px-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white">
                          Save
                        </button>
                      </Form>
                    ) : (
                      <span className="text-xs text-slate-400">read-only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function countByStatus(defects: { status: string }[]): Record<string, number> {
  const c: Record<string, number> = { open: 0, triaged: 0, fixed: 0, "wont-fix": 0 };
  for (const d of defects) {
    if (d.status in c) c[d.status]++;
  }
  return c;
}

function SeverityPill({ severity }: { severity: string }) {
  const cls =
    severity === "high"
      ? "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200"
      : severity === "med"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {severity}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    open: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
    triaged: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    fixed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    "wont-fix": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
        cls[status] ?? cls.open
      }`}
    >
      {status}
    </span>
  );
}

export function ErrorBoundary() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div role="alert">Defects page unavailable.</div>
    </main>
  );
}
