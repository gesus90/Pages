import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { Link, useLoaderData } from "react-router";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { AdminModeRequired } from "@/app/components/settings/admin-mode-required";
import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { PicaSettingsCard } from "@/app/components/settings/agents/pica-settings-card";
import { AgentChatSettingsCard } from "@/app/components/settings/agents/agent-chat-settings-card";
import { RunDiagnosisSettingsCard } from "@/app/components/settings/agents/run-diagnosis-settings-card";
import { SpeechSettingsCard } from "@/app/components/settings/agents/speech-settings-card";
import { AgentsSection } from "@/app/components/settings/agents/agents-section";
import { RunnerConnectionsCard } from "@/app/components/settings/agents/runner-connections-card";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { sendToBackend } from "@/app/lib/backend-request";
import { hasFailedCatalog } from "@/definition/AgentModelCatalog";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PicaAdministration } from "@/definition/PicaSettings";
import type { AgentChatSettings } from "@/definition/Conversation";
import type { AgentRunDiagnosisSettings } from "@/definition/AgentRunDiagnosis";
import type { SpeechAdministration } from "@/definition/SpeechRecognition";
import type { Route } from "./+types/settings-agents";
import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

/** The agents area as the endpoint answers it, or the request for the admin mode. */
export type AgentsLoaderData =
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
      readonly speech: SpeechAdministration;
      /** The hourly limit of messages one agent sends (PAGE-311). */
      readonly agentChat: AgentChatSettings;
      /** How long run logs are kept and when a silent step counts as stalled (PAGE-307). */
      readonly runDiagnosis: AgentRunDiagnosisSettings;
      readonly audience: LocalStateAudience;
    };

/** The rights-checked endpoint of the agents area. */
const SETTINGS_AGENTS_ENDPOINT = "/settings-api/agents";

function isAgentsRouteData(value: unknown): value is AgentsLoaderData {
  if (typeof value !== "object" || value === null || !("access" in value))
    return false;
  if (value.access === "adminModeRequired") return true;
  return (
    value.access === "granted" &&
    "connections" in value &&
    Array.isArray(value.connections) &&
    "runners" in value &&
    Array.isArray(value.runners) &&
    "pica" in value &&
    typeof value.pica === "object" &&
    "speech" in value &&
    typeof value.speech === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/**
 * The agents area, kept per account and rights.
 *
 * @remarks
 * The rights include the admin mode, so leaving it never shows the kept
 * metadata; the request for the admin mode is not kept.
 */
const SETTINGS_AGENTS_STATE: LocalStateRouteKind<AgentsLoaderData> = {
  schemaVersion: 4,
  isPayload: isAgentsRouteData,
  isCurrent: (agents) =>
    agents.access === "granted" && isCurrentLocalStateAudience(agents.audience),
  ownerOf: (agents) =>
    agents.access === "granted" ? agents.audience.userId : "",
  isRefused: (agents) => agents.access !== "granted",
};

/**
 * Opens the agents area from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint checks the administrator and the admin mode again, as the
 * server loader does; a refusal shows the same error as before.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<AgentsLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), SETTINGS_AGENTS_STATE, () =>
    readRouteData({
      endpoint: `${SETTINGS_AGENTS_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isAgentsRouteData,
    }),
  );
}

/** Sends a change of the agents area to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the complete management UI, or the existing admin-mode switch. */
export default function SettingsAgentsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const result = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    SETTINGS_AGENTS_STATE,
  );
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
      <SpeechSettingsCard
        administration={result.speech}
        isCatalogFailed={hasFailedCatalog(result.catalogs)}
      />
      <AgentChatSettingsCard settings={result.agentChat} />
      <RunDiagnosisSettingsCard settings={result.runDiagnosis} />
      <PicaSettingsCard
        settings={result.pica.settings}
        models={result.pica.models}
        isCatalogFailed={hasFailedCatalog(result.catalogs)}
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
