import { useTranslation } from "react-i18next";
import { data as routeData, useLoaderData } from "react-router";

import { AdminModeRequired } from "@/app/components/settings/admin-mode-required";
import { AgentsSection } from "@/app/components/settings/agents/agents-section";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { readAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import { handleAgentsAction } from "@/app/lib/settings-actions/settings-agents-actions.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";

import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { Route } from "./+types/settings-agents";

type AgentsLoaderData =
  | { readonly access: "adminModeRequired" }
  | {
      readonly access: "granted";
      readonly connections: readonly AgentConnectionSummary[];
      readonly cliTools: CliToolLocations;
      readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
    };

/**
 * Keeps the page, its data requests and every action answer out of caches.
 *
 * @remarks
 * React Router forwards only the cookies of loader and action headers, so the
 * route states `no-store` itself and keeps the security headers of its parents.
 */
export const headers: Route.HeadersFunction = ({ parentHeaders }) => {
  const responseHeaders = new Headers(parentHeaders);
  responseHeaders.set("Cache-Control", AGENT_NO_STORE["Cache-Control"]);
  return responseHeaders;
};

/** Loads secret-free metadata only for personal administrators in the active admin mode. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<AgentsLoaderData>>> {
  try {
    const services = await getApplicationServices();
    const actor = await readAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    if (actor.mode !== "admin")
      return routeData<AgentsLoaderData>(
        { access: "adminModeRequired" },
        { headers: AGENT_NO_STORE },
      );
    const [connections, cliTools, catalogs] = await Promise.all([
      services.agentConnectionService.list(actor),
      services.agentCliLoginService.tools(actor),
      services.agentCatalogService.list(actor),
    ]);
    return routeData<AgentsLoaderData>(
      { access: "granted", connections, cliTools, catalogs },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    throw agentFailureResponse(error);
  }
}

/** Keeps form secrets out of every success and failure response. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  try {
    return await handleAgentsAction(await readSettingsRequest(args));
  } catch (error: unknown) {
    return agentFailureResponse(error);
  }
}

/** Renders the complete management UI, or the existing admin-mode switch. */
export default function SettingsAgentsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const result = useLoaderData<typeof loader>();
  return result.access === "granted" ? (
    <AgentsSection
      connections={result.connections}
      cliTools={result.cliTools}
      catalogs={result.catalogs}
    />
  ) : (
    <AdminModeRequired description={t("settings.agents.adminModeRequired")} />
  );
}
