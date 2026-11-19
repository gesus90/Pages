import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  assessRequestOrigin,
  requestEntryContext,
} from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  AGENT_NO_STORE,
  agentFailureResponse,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { isApiProvider } from "@/definition/AgentConnection";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";
import type { Route } from "./+types/agent-model-catalogs";

function readSavedConnection(request: Request): string | null {
  const connectionId = new URL(request.url).searchParams.get("connection");
  return connectionId === null || connectionId === "" ? null : connectionId;
}

async function readReloadTarget(request: Request): Promise<string> {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0]?.trim();
  if (mediaType !== "application/json")
    throw new AgentError("connection_not_found");
  const body: unknown = await request.json().catch(() => null);
  const connectionId: unknown =
    typeof body === "object" && body !== null
      ? Reflect.get(body, "connectionId")
      : null;
  if (typeof connectionId !== "string" || connectionId === "")
    throw new AgentError("connection_not_found");
  return connectionId;
}

// A listing never confirms the access of an API connection, so a reload of an
// unconfirmed one checks the access first (metadata only, no model call); the
// passed check lists the models. Every other connection only lists them anew.
async function reloadConnection(
  services: ApplicationServices,
  actor: AccountAccess,
  connectionId: string,
): Promise<void> {
  const { connections } = await services.pageAgentService.catalogStatuses(
    actor.userId,
    null,
  );
  const status = connections.find(
    (entry) => entry.connectionId === connectionId,
  );
  if (status?.state === "unverified" && isApiProvider(status.provider)) {
    await services.agentCheckService.run(actor, connectionId, "auth");
    return;
  }
  await services.agentCatalogService.run(actor, connectionId);
}

/**
 * Answers the catalog state of every connection the person may use.
 * @remarks
 * The answer comes from the stored catalogs; opening a model choice asks no
 * provider. With `?connection=` it also says how that saved connection
 * relates to the person.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("agent_usage_denied");
    const services = await getApplicationServices();
    return Response.json(
      await services.pageAgentService.catalogStatuses(
        user.id,
        readSavedConnection(request),
      ),
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_model_catalogs", error);

    return agentFailureResponse(error);
  }
}

/**
 * Reloads one connection; only administrators may, and no other connection is touched.
 * @remarks
 * An API connection whose access is not confirmed gets its access checked,
 * which lists its models once it passes; any other connection lists its
 * models anew.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (
      request.method !== "POST" ||
      assessRequestOrigin(request, context.get(requestEntryContext))
    )
      throw new AgentAccessDeniedError();
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(services, user);
    await reloadConnection(services, actor, await readReloadTarget(request));
    return Response.json(
      await services.pageAgentService.catalogStatuses(actor.userId, null),
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_model_catalog_reload", error);

    return agentFailureResponse(error);
  }
}
