import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { requireUser } from "~/lib/auth/require-user";
import { runsRepo } from "~/lib/db/runs";
import { db } from "~/lib/db/client";
import { audit } from "~/lib/db/audit-log";

const RejectInput = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters").max(500),
});

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request, "tester");
  const runId = params.runId!;
  const scenarioId = params.scenarioId!;

  const formData = await request.formData();
  const parsed = RejectInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const scenario = await runsRepo.findScenario(runId, scenarioId);
  if (!scenario) throw new Response("Scenario not found", { status: 404 });
  if (scenario.review_status !== "pending_review") {
    return redirect(`/runs/${runId}`);
  }

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE scenarios
         SET review_status = 'rejected', reviewed_by = $1,
             reviewed_at = now(), reject_reason = $2
       WHERE id = $3 AND run_id = $4`,
      [user.id, parsed.data.reason, scenarioId, runId],
    );
    await audit(
      {
        actor: user.id,
        action: "reject",
        entity: `scenario:${scenarioId}`,
        payload: { runId, reason: parsed.data.reason, snapshot: scenario },
      },
      client,
    );
  });

  return redirect(`/runs/${runId}`);
}

export async function loader({ params }: ActionFunctionArgs) {
  return redirect(`/runs/${params.runId}`);
}
