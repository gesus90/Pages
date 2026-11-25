import { ChevronRight, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { cn } from "@/app/lib/cn";

import { AgentToolActions, isAgentToolSwitchable } from "./agent-tool-actions";
import {
  AgentToolConnectionProblems,
  AgentToolConnectionsFact,
} from "./agent-tool-card/agent-tool-connections";
import { AgentToolVersion } from "./agent-tool-card/agent-tool-release-facts";

import { AGENT_TOOL_UPDATE_TARGET_FIELD } from "@/definition/AgentTools";

import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { AgentToolIntent } from "./agent-tool-actions";
import type {
  AgentToolAction,
  AgentToolId,
  AgentToolStatus,
  AgentToolView,
} from "@/definition/AgentTools";

/** The settings action that runs every operation of the tools page. */
export const AGENT_TOOLS_ACTION_PATH = "/settings/tools";

interface ToolActionResult {
  readonly ok: boolean;
  /** An update was accepted and runs on; its row shows the progress. */
  readonly accepted?: boolean;
  readonly diagnostic?: string;
  readonly error?: string;
}

type StatusTone = "success" | "warning" | "destructive" | "muted" | "busy";

interface RowStatus {
  readonly tone: StatusTone;
  readonly labelKey: string;
}

const DOT_CLASS: Readonly<Record<Exclude<StatusTone, "busy">, string>> = {
  success: "bg-success-dot",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/50",
};

const TEXT_CLASS: Readonly<Record<StatusTone, string>> = {
  success: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  busy: "text-foreground",
};

const HEALTH_TONE: Readonly<Record<AgentToolStatus, StatusTone>> = {
  ready: "success",
  installing: "busy",
  updating: "busy",
  repairing: "busy",
  authentication_required: "warning",
  missing_dependency: "destructive",
  unsupported: "warning",
  failed: "destructive",
};

// Actions without a status of their own show their name while they run.
const RUNNING_LABEL: Readonly<Partial<Record<AgentToolAction, string>>> = {
  install: "agentTools.status.installing",
  update: "agentTools.status.updating",
  repair: "agentTools.status.repairing",
};

// Diagnostics that report no problem; the facts already show them.
const QUIET_DIAGNOSTICS: ReadonlySet<string> = new Set([
  "ready",
  "not_checked",
]);

/**
 * The fetcher of a tool row, shared with "Alle aktualisieren", so the row shows that submission too.
 * @param id - The tool of the row.
 */
export function agentToolFetcherKey(id: AgentToolId): string {
  return `agent-tool-${id}`;
}

/**
 * The form a row sends: the tool, the intent and the checked target the row shows.
 * @param tool - The tool of the row.
 * @param intent - The action or switch to run.
 */
export function agentToolFormData(
  tool: AgentToolView,
  intent: AgentToolIntent,
): FormData {
  const form = new FormData();
  form.set("tool", tool.id);
  form.set("intent", intent);
  form.set(AGENT_TOOL_UPDATE_TARGET_FIELD, tool.update.target ?? "");
  return form;
}

// A running or failed operation outranks the health of the installation it changes.
function rowStatusOf(tool: AgentToolView, isPending: boolean): RowStatus {
  const { operation } = tool;
  if (isPending) return { tone: "busy", labelKey: "agentTools.working" };
  if (operation?.state === "running")
    return {
      tone: "busy",
      labelKey:
        RUNNING_LABEL[operation.action] ??
        `agentTools.actions.${operation.action}`,
    };
  if (operation?.state === "failed")
    return { tone: "destructive", labelKey: "agentTools.status.failed" };
  if (isAgentToolSwitchable(tool) && !tool.enabled)
    return { tone: "muted", labelKey: "agentTools.status.disabled" };
  if (tool.installed === null)
    return { tone: "muted", labelKey: "agentTools.unknown" };
  if (!tool.installed) return { tone: "muted", labelKey: "agentTools.missing" };
  return {
    tone: HEALTH_TONE[tool.status],
    labelKey: `agentTools.status.${tool.status}`,
  };
}

function ToolStatus({
  status,
}: {
  readonly status: RowStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  const { tone } = status;
  return (
    <p
      className={cn(
        "pointer-events-none relative flex min-w-0 items-center gap-2 text-sm",
        TEXT_CLASS[tone],
      )}
    >
      {tone === "busy" ? (
        <Loader2
          className="size-3.5 shrink-0 text-primary motion-safe:animate-spin"
          aria-hidden="true"
        />
      ) : (
        <span
          className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[tone])}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{t(status.labelKey)}</span>
    </p>
  );
}

// Below the name: the running step, a refused click, or where the installation comes from.
function nameLine(
  t: TFunction,
  tool: AgentToolView,
  result: ToolActionResult | undefined,
): { readonly text: string; readonly isProblem: boolean } {
  const { operation } = tool;
  if (operation?.state === "running")
    return {
      text: t(`agentTools.operation.phase.${operation.phase}`),
      isProblem: false,
    };
  if (result && !result.ok)
    return {
      text: t(
        `agentTools.diagnostic.${result.diagnostic ?? "execution_failed"}`,
      ),
      isProblem: true,
    };
  const sourceKey =
    tool.source ?? (tool.installed === null ? "unchecked" : "none");
  return {
    text: t(`agentTools.source.${sourceKey}`),
    isProblem: false,
  };
}

function ToolName({
  tool,
  result,
}: {
  readonly tool: AgentToolView;
  readonly result: ToolActionResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const line = nameLine(t, tool, result);
  return (
    <div className="pointer-events-none relative min-w-0">
      <p className="truncate text-sm font-semibold text-foreground">
        {t(`agentTools.names.${tool.id}`)}
      </p>
      <p
        aria-live="polite"
        className={cn(
          "truncate text-xs",
          line.isProblem ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {line.text}
      </p>
    </div>
  );
}

function Fact({
  label,
  title,
  children,
}: {
  readonly label: string;
  readonly title?: string;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-6.5 min-w-0 items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground" title={title}>
        {children}
      </dd>
    </div>
  );
}

// Version, update target and status stand in the row itself and are not repeated here.
function ToolFacts({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const entry = tool.terminalEntry;
  return (
    <dl className="grid grid-cols-2 gap-x-10 text-sm">
      <Fact
        label={t("agentTools.executable")}
        title={tool.executable ?? undefined}
      >
        {tool.executable ? (
          <code className="pages-selectable">{tool.executable}</code>
        ) : (
          "—"
        )}
      </Fact>
      <Fact label={t("agentTools.lastCheck")}>
        {formatDateTime(tool.lastCheck)}
      </Fact>
      <Fact label={t("agentTools.terminalEntry")} title={entry?.path}>
        {entry
          ? t(
              entry.isCurrent
                ? "agentTools.terminalEntryCurrent"
                : "agentTools.terminalEntryStale",
            )
          : "—"}
      </Fact>
      <Fact label={t("agentTools.processes")}>{tool.activities.length}</Fact>
      <Fact label={t("agentTools.rollback")}>
        {tool.rollbackRelease ?? "—"}
      </Fact>
      <Fact label={t("agentTools.connections.title")}>
        <AgentToolConnectionsFact tool={tool} />
      </Fact>
    </dl>
  );
}

// Only problems appear below the facts: a refused click, a failed step, an unhealthy tool, a connection that lost something.
function ToolProblems({
  tool,
  result,
}: {
  readonly tool: AgentToolView;
  readonly result: ToolActionResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { operation } = tool;
  const failedOperation = operation?.state === "failed" ? operation : null;
  const showsDiagnostic =
    tool.status !== "ready" &&
    !QUIET_DIAGNOSTICS.has(tool.diagnostic) &&
    tool.diagnostic !== failedOperation?.diagnostic;
  const dependency = tool.dependency
    ? ` (${t(`agentTools.names.${tool.dependency}`)})`
    : "";
  return (
    <ul className="mt-2 space-y-1 text-xs break-words text-destructive empty:hidden">
      {result && !result.ok ? (
        <li>
          {t(
            `agentTools.diagnostic.${result.diagnostic ?? "execution_failed"}`,
          )}
        </li>
      ) : null}
      {failedOperation ? (
        <li>
          {t("agentTools.operation.failed", {
            action: t(`agentTools.actions.${failedOperation.action}`),
            phase: t(`agentTools.operation.phase.${failedOperation.phase}`),
          })}
          {failedOperation.diagnostic
            ? ` ${t(`agentTools.diagnostic.${failedOperation.diagnostic}`)}`
            : ""}
        </li>
      ) : null}
      {showsDiagnostic ? (
        <li>
          {t(`agentTools.diagnostic.${tool.diagnostic}`)}
          {dependency}
        </li>
      ) : null}
      <AgentToolConnectionProblems connections={tool.connections} />
    </ul>
  );
}

/**
 * One tool as a collapsible row: name and source, version, status, at most one main action and the menu "…".
 * @remarks
 * The whole row opens and closes its facts; only the action buttons and the
 * menu do not. Its fetcher is keyed by the tool, so an update that "Alle
 * aktualisieren" started shows here as well.
 */
export function AgentToolCard({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const detailsId = useId();
  const fetcher = useFetcher<ToolActionResult>({
    key: agentToolFetcherKey(tool.id),
  });
  const isPending = fetcher.state !== "idle";

  function handleSubmit(intent: AgentToolIntent): void {
    void fetcher.submit(agentToolFormData(tool, intent), {
      method: "post",
      action: AGENT_TOOLS_ACTION_PATH,
    });
  }

  return (
    <li className="border-t border-border">
      <div className="relative grid h-12 grid-cols-[0.875rem_minmax(0,1fr)_9rem_12rem_10rem] items-center gap-3 px-4">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? detailsId : undefined}
          aria-label={t(`agentTools.names.${tool.id}`)}
          onClick={() => setIsExpanded(!isExpanded)}
          className="absolute inset-0 cursor-pointer hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        />
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "pointer-events-none relative size-3.5 text-muted-foreground motion-safe:transition-transform motion-safe:duration-120",
            isExpanded && "rotate-90",
          )}
        />
        <ToolName tool={tool} result={fetcher.data} />
        <AgentToolVersion tool={tool} />
        <ToolStatus status={rowStatusOf(tool, isPending)} />
        <AgentToolActions
          tool={tool}
          isPending={isPending}
          onSubmit={handleSubmit}
        />
      </div>
      {isExpanded ? (
        <div
          id={detailsId}
          className="border-t border-border py-2 pr-4 pl-10.5"
        >
          <ToolFacts tool={tool} />
          <ToolProblems tool={tool} result={fetcher.data} />
        </div>
      ) : null}
    </li>
  );
}
