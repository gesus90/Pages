import { ChevronRight, RefreshCw, Wrench } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSubmit,
} from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { canUpdateAgentTool } from "@/app/components/settings/agents/tools/agent-tool-actions";
import {
  AGENT_TOOLS_ACTION_PATH,
  AgentToolCard,
  agentToolFetcherKey,
  agentToolFormData,
} from "@/app/components/settings/agents/tools/agent-tool-card";
import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
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
import type {
  AgentToolId,
  AgentToolKind,
  AgentToolView,
} from "@/definition/AgentTools";
import type { Route } from "./+types/settings-agent-tools";

/** The tool inventory together with the account and rights it was read for. */
export interface AgentToolsData {
  readonly tools: readonly AgentToolView[];
  readonly audience: LocalStateAudience;
}

/** One group of the tools card and the tool kinds it holds. */
interface ToolGroupDefinition {
  readonly id: "agents" | "acp" | "runtime" | "browser";
  readonly kinds: readonly AgentToolKind[];
}

/** The rights-checked endpoint of the tool inventory. */
const SETTINGS_AGENT_TOOLS_ENDPOINT = "/settings-api/agent-tools";

const TOOL_GROUPS: readonly ToolGroupDefinition[] = [
  { id: "agents", kinds: ["agent"] },
  { id: "acp", kinds: ["acp"] },
  { id: "runtime", kinds: ["runtime", "sandbox"] },
  { id: "browser", kinds: ["mcp", "browser"] },
];

// "Alle aktualisieren" appears only when it saves more than one click.
const MIN_TOOLS_FOR_UPDATE_ALL = 2;

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

// One update moves a CLI together with its adapter, so each combination starts once.
function updateStarts(
  tools: readonly AgentToolView[],
): readonly AgentToolView[] {
  const covered = new Set<AgentToolId>();
  const starts: AgentToolView[] = [];
  for (const tool of tools) {
    if (covered.has(tool.id)) continue;
    starts.push(tool);
    covered.add(tool.id);
    for (const entry of tool.update.targetVersions) covered.add(entry.id);
  }
  return starts;
}

// The newest version search of any tool is the last time "Updates suchen" ran.
function lastSearchOf(tools: readonly AgentToolView[]): string | null {
  let latest: string | null = null;
  for (const { release } of tools) {
    if (release.checkedAt === null) continue;
    if (latest === null || Date.parse(release.checkedAt) > Date.parse(latest))
      latest = release.checkedAt;
  }
  return latest;
}

// Reads release metadata of the fixed official sources; nothing is installed by it.
function UpdateSearchButton(): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const isPending = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" action={AGENT_TOOLS_ACTION_PATH}>
      <Button
        type="submit"
        name="intent"
        value={AGENT_TOOL_CHECK_UPDATES}
        size="xs"
        variant="outline"
        disabled={isPending}
      >
        <RefreshCw
          className={cn("size-3.5", isPending && "motion-safe:animate-spin")}
          aria-hidden="true"
        />
        {t("agentTools.checkUpdates")}
      </Button>
    </fetcher.Form>
  );
}

// Starts every shown update at once, through the fetcher of each row so the rows show it.
function UpdateAllButton({
  tools,
}: {
  readonly tools: readonly AgentToolView[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [isStarting, setIsStarting] = useState(false);

  async function startUpdates(): Promise<void> {
    setIsStarting(true);
    try {
      for (const tool of updateStarts(tools))
        await submit(agentToolFormData(tool, "update"), {
          method: "post",
          action: AGENT_TOOLS_ACTION_PATH,
          navigate: false,
          fetcherKey: agentToolFetcherKey(tool.id),
        });
    } finally {
      setIsStarting(false);
    }
  }

  if (tools.length < MIN_TOOLS_FOR_UPDATE_ALL) return null;
  return (
    <Button
      size="xs"
      isPending={isStarting}
      onClick={() => void startUpdates()}
    >
      {t("agentTools.updateAll", { count: tools.length })}
    </Button>
  );
}

function ToolsToolbar({
  tools,
}: {
  readonly tools: readonly AgentToolView[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const lastSearch = lastSearchOf(tools);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <UpdateSearchButton />
      <UpdateAllButton tools={tools.filter(canUpdateAgentTool)} />
      <p className="text-xs text-muted-foreground">
        {lastSearch === null
          ? t("agentTools.release.state.not_checked")
          : t("agentTools.lastSearched", { date: formatDateTime(lastSearch) })}
      </p>
    </div>
  );
}

// A group stays mounted while closed, so open rows and their dialogs keep their state.
function ToolGroup({
  group,
  tools,
}: {
  readonly group: ToolGroupDefinition;
  readonly tools: readonly AgentToolView[];
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const listId = useId();
  return (
    <section className="border-t border-border first:border-t-0">
      <h3>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-9 w-full cursor-pointer items-center gap-3 bg-muted/40 px-4 text-xs text-muted-foreground hover:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 motion-safe:transition-transform motion-safe:duration-120",
              isOpen && "rotate-90",
            )}
          />
          <span className="flex-1 text-left font-semibold">
            {t(`agentTools.groups.${group.id}`)}
          </span>
          <span>{t("agentTools.toolCount", { count: tools.length })}</span>
        </button>
      </h3>
      <ul id={listId} hidden={!isOpen}>
        {tools.map((tool) => (
          <AgentToolCard key={tool.id} tool={tool} />
        ))}
      </ul>
    </section>
  );
}

// The card is not scrolling itself, so its shell carries radius, fill and ring and clips the rows' hover.
function ToolsCard({
  tools,
}: {
  readonly tools: readonly AgentToolView[];
}): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-border/70">
      {TOOL_GROUPS.map((group) => {
        const members = tools.filter((tool) => group.kinds.includes(tool.kind));
        return members.length === 0 ? null : (
          <ToolGroup key={group.id} group={group} tools={members} />
        );
      })}
    </div>
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
    <div className="space-y-3">
      <SettingsSectionHeader
        icon={<Wrench className="size-4" aria-hidden="true" />}
        title={t("settings.navigation.tools")}
      />
      <ToolsToolbar tools={tools} />
      <ToolsCard tools={tools} />
    </div>
  );
}
