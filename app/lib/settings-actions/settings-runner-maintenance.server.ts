import { z } from "zod";

import { AGENT_NO_STORE } from "./settings-agents-response.server";

import type { SettingsActionContext } from "./settings-action-support.server";

/** Handles release and address choices after the route enforced active administrator access. */
export async function handleRunnerMaintenanceRequest(
  context: SettingsActionContext,
): Promise<Response | null> {
  const { formData, services, user, request } = context;
  const intent = formData.get("intent");
  if (intent === "runner-settings") {
    await services.runnerMaintenanceService.save({
      address: String(formData.get("address") ?? "").trim() || null,
      allowInsecureLan: formData.get("allowInsecureLan") === "on",
      automaticUpdates: formData.get("automaticUpdates") === "on",
    });
    return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
  }
  if (intent !== "runner-update" && intent !== "authorize") return null;
  const connectionId = z.string().uuid().parse(formData.get("connectionId"));
  if (intent === "runner-update") {
    await services.runnerMaintenanceService.request(user.id, connectionId);
    return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
  }
  const connection = await services.remoteConnectionService.requireUsable(
    user.id,
    connectionId,
  );
  const pairing = await services.runnerMaintenanceService.pairing(
    connectionId,
    new URL(request.url).origin,
    connection.host,
  );
  const grant = await services.runnerService.authorize(user.id, connectionId);
  return Response.json(
    { ok: true, intent, ...grant, ...pairing },
    { headers: AGENT_NO_STORE },
  );
}
