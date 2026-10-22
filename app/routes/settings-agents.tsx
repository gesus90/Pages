import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { data as routeData, Link, useLoaderData } from "react-router";

import { AdminModeRequired } from "@/app/components/settings/admin-mode-required";
import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { PicaSettingsCard } from "@/app/components/settings/agents/pica-settings-card";
import { AgentsSection } from "@/app/components/settings/agents/agents-section";
import { RunnerConnectionsCard } from "@/app/components/settings/agents/runner-connections-card";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { readAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import { handleAgentsAction } from "@/app/lib/settings-actions/settings-agents-actions.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PicaAdministration } from "@/definition/PicaSettings";
import type { Route } from "./+types/settings-agents";
import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

type AgentsLoaderData =
  | { readonly access: "adminModeRequired" }
  | {
      readonly access: "granted";
      readonly connections: readonly AgentConnectionSummary[];
      readonly runners: readonly RunnerConnectionView[];
      readonly runnerGitHubMode: "offline" | "http";
      readonly cliTools: CliToolLocations;
      readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
      readonly profileDirectory: AgentProfileDirectory;
      readonly pica: {
        readonly settings: PicaAdministration;
        readonly models: readonly PageAgentModel[];
      };
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
    const [connections, cliTools, catalogs, profileDirectory, pica, runners] =
      await Promise.all([
        services.agentConnectionService.list(actor),
        services.agentCliLoginService.tools(actor),
        services.agentCatalogService.list(actor),
        services.agentProfileService.directory(actor),
        services.picaSettingsService.administration(actor.userId),
        services.runnerService.overview(actor.userId),
      ]);
    return routeData<AgentsLoaderData>(
      {
        access: "granted",
        connections,
        runners,
        runnerGitHubMode: services.runnerGitHubMode,
        cliTools,
        catalogs,
        profileDirectory,
        pica,
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("settings_agents", error);

    throw agentFailureResponse(error);
  }
}

/** Keeps form secrets out of every success and failure response. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  try {
    return await handleAgentsAction(await readSettingsRequest(args));
  } catch (error: unknown) {
    logCaughtError("settings_agents", error);

    return agentFailureResponse(error);
  }
}

/** Renders the complete management UI, or the existing admin-mode switch. */
export default function SettingsAgentsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const result = useLoaderData<typeof loader>();
  return result.access === "granted" ? (
    <div className="space-y-4">
      <SettingsSectionHeader
        icon={<Bot className="size-4" aria-hidden="true" />}
        title={t("settings.agents.title")}
      />
      <AgentsSection
        connections={result.connections}
        cliTools={result.cliTools}
        catalogs={result.catalogs}
        profileDirectory={result.profileDirectory}
      />
      <RunnerConnectionsCard
        connections={result.runners}
        githubMode={result.runnerGitHubMode}
      />
      <PicaSettingsCard
        settings={result.pica.settings}
        models={result.pica.models}
      />
      <Link
        className="inline-flex rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-primary-text hover:bg-surface-hover"
        to="/settings/agents/tools"
      >
        {t("agentTools.title")}
      </Link>
    </div>
  ) : (
    <AdminModeRequired description={t("settings.agents.adminModeRequired")} />
  );
}
