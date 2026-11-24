import { useTranslation } from "react-i18next";

import { AccessBadge } from "@/app/components/agents/badges/access-badge";
import { ModelBadge } from "@/app/components/agents/badges/model-badge";
import { ReasoningBadge } from "@/app/components/agents/badges/reasoning-badge";
import { RunBranchBadge } from "@/app/components/agents/badges/run-branch-badge";
import { modelBadgeDisplay } from "@/app/components/agents/model-picker/model-catalog";
import { modelBadgeVendor } from "@/definition/AgentModelIdentity";
import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { ConsoleContextSection } from "./console-context-section";
import { providerBadgeKey } from "./console-header-badges";
import {
  Fact,
  RowBadge,
  SidebarRow,
  SidebarSection,
} from "./console-sidebar-parts";
import { infrastructureRestarts } from "./console-step-state";
import { formatClock } from "./console-time";
import { ConsoleTodoList } from "./console-todo-list";
import { useNow } from "./use-terminal-surface";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionView } from "@/definition/AgentSessionJournal";
import type { AntigravityUsageTotal } from "@/definition/AgentSessionPricing";

const SIDEBAR_KEY = "plans.console.terminal.sidebar";
const USAGE_KEY = `${SIDEBAR_KEY}.usage`;

/** The counts after the input, each in its own row; cache reads and writes never merge into the input. */
const TOKEN_ROWS = [
  "cacheReadTokens",
  "cacheWriteTokens",
  "outputTokens",
  "totalTokens",
] as const;

/** An estimate keeps up to four decimals, so a cent fraction of a short session stays visible. */
const ESTIMATE_FORMAT: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
};

interface ConsoleSidebarProps {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
  /** The role of a swarm session, such as „Helfer 1“; absent outside a swarm. */
  readonly roleLabel?: string;
}

function activityText(
  step: AgentPlanStepResult,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (step.status !== "running") return null;
  if (step.session?.retry?.state === "waiting")
    return t(`${SIDEBAR_KEY}.activityWaiting`);
  return (
    step.progress?.activity?.text ?? step.session?.activity?.titles[0] ?? null
  );
}

function workspaceName({ step, view }: ConsoleSidebarProps): string | null {
  const target = step.execution?.target;
  if (target?.kind === "remote" && target.workspaceName)
    return target.workspaceName;
  const named = view.runBranch?.expected?.workspaceName;
  if (named) return named;
  const directory =
    view.workspace?.directory ??
    step.session?.requested.directory ??
    step.execution?.workspace.path;
  return directory?.split("/").filter(Boolean).at(-1) ?? null;
}

/** The process lifetime of this attempt, including any additional turns. */
function RuntimeValue({
  step,
  view,
  unknown,
}: ConsoleSidebarProps & { readonly unknown: string }): React.ReactElement {
  const { session } = step;
  const startedAt = Date.parse(session?.startedAt ?? "");
  const retryEnd = session?.retry?.attempts.find(
    (attempt) => attempt.attemptId === view.key.attemptId,
  )?.endedAt;
  const closedAt = session?.endedAt ?? retryEnd;
  const isRunning = isAttemptRunning(step, view, startedAt, closedAt);
  const now = useNow(isRunning);
  const end = attemptEnd(isRunning, now, closedAt, session?.turnEndedAt);
  return (
    <span className="tabular-nums">{runtimeText(startedAt, end, unknown)}</span>
  );
}

/** Whether this attempt still produces output. */
function isAttemptRunning(
  step: AgentPlanStepResult,
  view: AgentSessionView,
  startedAt: number,
  closedAt: string | undefined,
): boolean {
  return (
    Number.isFinite(startedAt) &&
    !closedAt &&
    step.status === "running" &&
    !["ended", "failed", "cancelled"].includes(view.state)
  );
}

/** The instant the attempt stopped, or the current time while it runs. */
function attemptEnd(
  isRunning: boolean,
  now: number,
  closedAt: string | undefined,
  turnEndedAt: string | null | undefined,
): number {
  return isRunning ? now : Date.parse(closedAt ?? turnEndedAt ?? "");
}

/** The lifetime as a clock, or the unknown text without a usable span. */
function runtimeText(startedAt: number, end: number, unknown: string): string {
  return Number.isFinite(startedAt) && Number.isFinite(end)
    ? formatClock(end - startedAt)
    : unknown;
}

function ModelValue({
  step,
  view,
  unknown,
}: ConsoleSidebarProps & { readonly unknown: string }): React.ReactNode {
  const { t } = useTranslation();
  const { modelIdentity, model } = view;
  if (!modelIdentity) return unknown;
  const provider = providerBadgeKey(
    step.execution?.modelAccess.provider ?? modelIdentity.provider,
    [model.requestedModel.value, model.confirmedModel.value],
  );
  const vendor = modelBadgeVendor(provider);
  if (!vendor) return unknown;
  const badge = modelBadgeDisplay({ ...modelIdentity, provider }, t);
  return (
    <RowBadge width="wide">
      <ModelBadge
        hasKeyboardTooltip
        isVendorHidden
        vendor={vendor}
        name={badge.name}
        source={badge.source}
        status={modelIdentity.status}
      />
    </RowBadge>
  );
}

function ReasoningValue({
  view,
  unknown,
}: {
  readonly view: AgentSessionView;
  readonly unknown: string;
}): React.ReactNode {
  const { reasoning } = view;
  if (!reasoning?.value || reasoning.status === "unknown") return unknown;
  return (
    <RowBadge>
      <ReasoningBadge
        level={reasoning.value}
        status={reasoning.status}
        isOffered={reasoning.isOffered}
      />
    </RowBadge>
  );
}

function BranchValue({
  view,
  unknown,
}: {
  readonly view: AgentSessionView;
  readonly unknown: string;
}): React.ReactNode {
  const branch = view.runBranch;
  if (!branch || (!branch.expected && branch.actual.state !== "branch"))
    return unknown;
  return (
    <RowBadge>
      <RunBranchBadge branch={branch} />
    </RowBadge>
  );
}

/** The input row's label: what the reported input contains decides whether the cache reads are part of it. */
function inputLabelKey(includesCache: boolean | null): string {
  if (includesCache === null) return `${USAGE_KEY}.input`;
  return includesCache
    ? `${USAGE_KEY}.inputWithCache`
    : `${USAGE_KEY}.inputWithoutCache`;
}

/** A count as reported; a reported 0 stays 0, a count never reported is unknown. */
function countText(
  count: number | null,
  numbers: Intl.NumberFormat,
  unknown: string,
): string {
  return count === null ? unknown : numbers.format(count);
}

/**
 * The notes below the usage rows: every reason without an estimate, the
 * price basis of an estimate, and what Antigravity does not deliver.
 */
function usageNotes(
  usage: AntigravityUsageTotal,
  { t, i18n }: Pick<ReturnType<typeof useTranslation>, "t" | "i18n">,
): readonly string[] {
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const notes = usage.gaps.map((gap) => t(`${USAGE_KEY}.gap.${gap}`));
  if (usage.amountUsd !== null)
    notes.push(
      t(`${USAGE_KEY}.estimateBasis`, {
        models: usage.priceModels.join(", "),
        dates: usage.priceAsOf
          .filter((priceAsOf) => Number.isFinite(Date.parse(priceAsOf)))
          .map((priceAsOf) => dates.format(new Date(priceAsOf)))
          .join(", "),
      }),
    );
  notes.push(t(`${USAGE_KEY}.notDelivered`));
  return notes;
}

/**
 * The block "Sitzungsverbrauch": the tokens the selected attempt's session
 * processed, summed over its turns, and what they cost.
 * @remarks
 * The counts are the adapter's own; Pages adds no cache count to the input
 * or the total. Antigravity reports no charge, so "Berechnet" stays not
 * available, and the estimate from a catalog price stands in its own row,
 * marked as an equivalent. Without complete counts and a price of the model
 * there is no estimate, and the notes name why.
 */
function UsageSection({
  usage,
}: {
  readonly usage: AntigravityUsageTotal;
}): React.ReactElement {
  const translation = useTranslation();
  const { t, i18n } = translation;
  const unknown = t(`${SIDEBAR_KEY}.unknown`);
  const unavailable = t(`${USAGE_KEY}.unavailable`);
  const numbers = new Intl.NumberFormat(i18n.language);
  const currency = new Intl.NumberFormat(i18n.language, ESTIMATE_FORMAT);
  const estimate =
    usage.amountUsd === null
      ? unavailable
      : t(`${USAGE_KEY}.estimateValue`, {
          amount: currency.format(usage.amountUsd),
        });
  return (
    <SidebarSection title={t(`${USAGE_KEY}.title`)}>
      <dl className="mt-1" data-console-usage="">
        <Fact
          label={t(inputLabelKey(usage.inputIncludesCache))}
          value={countText(usage.inputTokens, numbers, unknown)}
        />
        {TOKEN_ROWS.map((field) => (
          <Fact
            key={field}
            label={t(`${USAGE_KEY}.${field}`)}
            value={countText(usage[field], numbers, unknown)}
          />
        ))}
        <Fact label={t(`${USAGE_KEY}.charged`)} value={unavailable} />
        <Fact label={t(`${USAGE_KEY}.estimate`)} value={estimate} />
      </dl>
      <ul className="mt-1.5 space-y-1 text-xs text-agent-console-muted">
        {usageNotes(usage, translation).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </SidebarSection>
  );
}

function SessionSection(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  const { step, view } = props;
  const unknown = t(`${SIDEBAR_KEY}.unknown`);
  const access = step.session?.requested.options?.access;
  return (
    <SidebarSection title={t(`${SIDEBAR_KEY}.session`)}>
      <dl className="mt-1">
        {props.roleLabel ? (
          <Fact label={t(`${SIDEBAR_KEY}.role`)} value={props.roleLabel} />
        ) : null}
        <SidebarRow label={t(`${SIDEBAR_KEY}.runtime`)}>
          <RuntimeValue {...props} unknown={unknown} />
        </SidebarRow>
        <SidebarRow label={t(`${SIDEBAR_KEY}.model`)}>
          <ModelValue {...props} unknown={unknown} />
        </SidebarRow>
        <SidebarRow label={t(`${SIDEBAR_KEY}.reasoning`)}>
          <ReasoningValue view={view} unknown={unknown} />
        </SidebarRow>
        <SidebarRow label={t(`${SIDEBAR_KEY}.access`)}>
          {access ? (
            <RowBadge>
              <AccessBadge access={access} />
            </RowBadge>
          ) : (
            unknown
          )}
        </SidebarRow>
        <SidebarRow label={t(`${SIDEBAR_KEY}.branch`)}>
          <BranchValue view={view} unknown={unknown} />
        </SidebarRow>
        <Fact
          label={t(`${SIDEBAR_KEY}.workspace`)}
          value={workspaceName(props) ?? unknown}
        />
        <Fact
          label={t(`${SIDEBAR_KEY}.restarts`)}
          value={`${infrastructureRestarts(step)} / ${PLAN_BLOCKER_RETRIES.infrastructure}`}
        />
      </dl>
    </SidebarSection>
  );
}

/**
 * The attempt's progress, context and session facts in the plan terminal.
 * @remarks
 * Every provider shows the todo list first, then the context, then the
 * session. An Antigravity attempt shows its summed session usage between
 * context and session, so the occupancy of the window and the tokens the
 * session processed stand apart. The todo list takes the remaining room. A
 * short window scrolls the whole sidebar so the context and session rows
 * remain reachable.
 */
export function ConsoleSidebar(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t("plans.console.details")}
      className="flex min-w-0 shrink-0 flex-col overflow-y-auto border-t border-agent-console-border bg-agent-console-surface px-5 pt-5 pb-8 [&>*+*]:mt-3.5 [&>*+*]:border-t [&>*+*]:border-agent-console-border [&>*+*]:pt-3.5 min-[680px]:w-[300px] min-[680px]:border-t-0 min-[680px]:border-l"
    >
      <ConsoleTodoList
        step={props.step}
        activity={activityText(props.step, t)}
      />
      <ConsoleContextSection view={props.view} />
      {props.view.antigravity ? (
        <UsageSection usage={props.view.antigravity.attempt} />
      ) : null}
      <SessionSection {...props} />
    </aside>
  );
}
