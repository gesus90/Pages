import { Wrench } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { AgentToolCard } from "@/app/components/settings/agents/tools/agent-tool-card";
import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
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
import { AGENT_TOOL_CHECK_UPDATES } from "@/definition/AgentTools";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { AgentToolView } from "@/definition/AgentTools";
import type { Route } from "./+types/settings-agent-tools";

/** The tool inventory together with the account and rights it was read for. */
export interface AgentToolsData {
  readonly tools: readonly AgentToolView[];
  readonly audience: LocalStateAudience;
}

/** The rights-checked endpoint of the tool inventory. */
const SETTINGS_AGENT_TOOLS_ENDPOINT = "/settings-api/agent-tools";

function isAgentToolsData(value: unknown): value is AgentToolsData {
  return (
    typeof value === "object" &&
    value !== null &&
    "tools" in value &&
    Array.isArray(value.tools) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The tool inventory, kept per account and rights, the admin mode included. */
const SETTINGS_AGENT_TOOLS_STATE: LocalStateRouteKind<AgentToolsData> = {
  // 4: tools name their update capability and the checked target an update click binds to.
  schemaVersion: 4,
  isPayload: isAgentToolsData,
  isCurrent: (inventory) => isCurrentLocalStateAudience(inventory.audience),
  ownerOf: (inventory) => inventory.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the tool inventory from the account's kept answer at once and asks the endpoint behind it.
 * @remarks
 * The endpoint enforces the same administrator rights as the server loader;
 * the polling of the page reads the endpoint as well.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<AgentToolsData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), SETTINGS_AGENT_TOOLS_STATE, () =>
    readRouteData({
      endpoint: `${SETTINGS_AGENT_TOOLS_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isAgentToolsData,
    }),
  );
}

/** Sends a change of an agent tool to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

// Reads release metadata of the fixed official sources; nothing is installed by it.
function UpdateSearch(): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const isPending = fetcher.state !== "idle";
  return (
    <fetcher.Form
      method="post"
      action="/settings/tools"
      className="flex flex-wrap items-center gap-3"
    >
      <Button
        type="submit"
        name="intent"
        value={AGENT_TOOL_CHECK_UPDATES}
        size="sm"
        disabled={isPending}
      >
        {t(isPending ? "agentTools.working" : "agentTools.checkUpdates")}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t("agentTools.checkUpdatesHint")}
      </p>
    </fetcher.Form>
  );
}

/** Renders the Tools settings area: the system-admin tool inventory with cached status polling and bounded actions. */
export default function SettingsAgentToolsRoute(): React.ReactElement {
  const { tools } = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    SETTINGS_AGENT_TOOLS_STATE,
  );
  const { t } = useTranslation();
  const { revalidate } = useRevalidator();
  useEffect(() => {
    const timer = setInterval(() => {
      void revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [revalidate]);
  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        icon={<Wrench className="size-4" aria-hidden="true" />}
        title={t("agentTools.title")}
      />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {t("agentTools.description")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("agentTools.hostHint")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("agentTools.runtimeHint")}
        </p>
      </div>
      <UpdateSearch />
      <div className="grid gap-4 xl:grid-cols-2">
        {tools.map((tool) => (
          <AgentToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
