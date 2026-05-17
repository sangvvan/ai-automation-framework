import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { requireUser } from "~/lib/auth/require-user";
import { runsRepo } from "~/lib/db/runs";
import { db } from "~/lib/db/client";
import { audit } from "~/lib/db/audit-log";
import { writeApprovedScenario } from "~/lib/review/promotion";
import { loadConfig } from "~/lib/config";

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request, "tester");
  const runId = params.runId!;
  const scenarioId = params.scenarioId!;

  const scenario = await runsRepo.findScenario(runId, scenarioId);
  if (!scenario) {
    throw new Response("Scenario not found", { status: 404 });
  }
  if (scenario.review_status !== "pending_review") {
    return redirect(`/runs/${runId}`);
  }
  const cfg = loadConfig();
  const file = await writeApprovedScenario(scenario, {
    approvedDir: cfg.testsApprovedDir,
    regressionDir: cfg.testsRegressionDir,
  }, { id: user.id, name: user.name });

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE scenarios
         SET review_status = 'approved', reviewed_by = $1, reviewed_at = now(),
             spec_yaml = $2
       WHERE id = $3 AND run_id = $4`,
      [user.id, file, scenarioId, runId],
    );
    await audit(
      {
        actor: user.id,
        action: "approve",
        entity: `scenario:${scenarioId}`,
        payload: { runId, spec: file, snapshot: scenario },
      },
      client,
    );
  });

  return redirect(`/runs/${runId}`);
}

export async function loader({ params }: ActionFunctionArgs) {
  return redirect(`/runs/${params.runId}`);
}
