import { useTranslation } from "react-i18next";
import { data as routeData, useLoaderData } from "react-router";

import { AdminModeRequired } from "@/app/components/settings/admin-mode-required";
import { AcpResourcesCard } from "@/app/components/settings/agents/acp-resources-card";
import { AgentsSection } from "@/app/components/settings/agents/agents-section";
import { readAgentFilters } from "@/definition/AgentFilters";
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

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { TextAssistantSettings } from "@/definition/TextAssistant";
import type { AgentAssignmentView } from "@/definition/AgentAssignment";
import type {
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { Route } from "./+types/settings-agents";
import type { AgentAvailability } from "@/definition/AgentAvailability";
import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";

type AgentsLoaderData =
  | { readonly access: "adminModeRequired" }
  | {
      readonly access: "granted";
      readonly connections: readonly AgentConnectionSummary[];
      readonly cliTools: CliToolLocations;
      readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
      readonly assistantSettings: TextAssistantSettings;
      readonly profiles: readonly AgentProfile[];
      readonly profileDirectory: AgentProfileDirectory;
      readonly assignments: readonly AgentAssignmentView[];
      readonly workspaceChoices: readonly AgentWorkspaceChoice[];
      readonly availability: Readonly<Record<string, AgentAvailability>>;
      readonly filters: AgentFilters;
      readonly projects: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly taskAssignments: Readonly<
        Record<string, readonly AgentTaskAssignment[]>
      >;
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
  request,
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
    const filters = readAgentFilters(new URL(request.url).searchParams);
    const [
      connections,
      cliTools,
      catalogs,
      assistantSettings,
      assignments,
      agentList,
      profileDirectory,
      projects,
      workspaceChoices,
      taskAssignments,
    ] = await Promise.all([
      services.agentConnectionService.list(actor),
      services.agentCliLoginService.tools(actor),
      services.agentCatalogService.list(actor),
      services.textAgentRoleService.read(actor),
      services.agentAssignmentService.list(actor),
      services.agentProfileService.filteredList(actor, filters),
      services.agentProfileService.directory(actor),
      services.agentProfileService.projects(actor),
      services.agentWorkspaceService.choices(actor.userId),
      services.agentPlanService.taskAssignments(actor),
    ]);
    return routeData<AgentsLoaderData>(
      {
        access: "granted",
        connections,
        cliTools,
        catalogs,
        assistantSettings,
        assignments,
        profiles: agentList.profiles,
        availability: agentList.availability,
        filters,
        projects,
        profileDirectory,
        workspaceChoices,
        taskAssignments,
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
      <AcpResourcesCard />
      <AgentsSection
        connections={result.connections}
        cliTools={result.cliTools}
        catalogs={result.catalogs}
        assistantSettings={result.assistantSettings}
        assignments={result.assignments}
        profiles={result.profiles}
        profileDirectory={result.profileDirectory}
        availability={result.availability}
        filters={result.filters}
        projects={result.projects}
        workspaceChoices={result.workspaceChoices}
        taskAssignments={result.taskAssignments}
      />
    </div>
  ) : (
    <AdminModeRequired description={t("settings.agents.adminModeRequired")} />
  );
}
