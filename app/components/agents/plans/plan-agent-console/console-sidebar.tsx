import { useTranslation } from "react-i18next";

import { AccessBadge } from "@/app/components/agents/badges/access-badge";
import { ModelBadge } from "@/app/components/agents/badges/model-badge";
import { ReasoningBadge } from "@/app/components/agents/badges/reasoning-badge";
import { RunBranchBadge } from "@/app/components/agents/badges/run-branch-badge";
import { modelBadgeDisplay } from "@/app/components/agents/model-picker/model-catalog";
import { cn } from "@/app/lib/cn";
import { modelBadgeVendor } from "@/definition/AgentModelIdentity";
import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { ConsoleContextSection } from "./console-context-section";
import { providerBadgeKey } from "./console-header-badges";
import {
  Fact,
  RowBadge,
  SIDEBAR_TITLE_CLASS,
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

/**
 * The rows of the block "Verbrauch" in their fixed order, one per count
 * Antigravity reports; cache reads and writes never merge into the input.
 */
const USAGE_ROWS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

/** The value of a count that has not been reported yet. */
const NOT_REPORTED = "–";

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

/**
 * Whether the counts of the selected attempt come only with the end of its
 * running turn.
 * @remarks
 * A local session reads each finished model call from the conversation
 * store of `agy acp` while the prompt runs. A runner reports the counts of
 * a prompt only with its answer.
 */
function isWaitingForTurnEnd(
  step: AgentPlanStepResult,
  view: AgentSessionView,
): boolean {
  return (
    step.execution?.target?.kind === "remote" &&
    step.status === "running" &&
    (view.state === "running" || view.state === "starting")
  );
}

/** One row of the block "Verbrauch"; a value not reported yet stands as a muted dash. */
function UsageRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}): React.ReactElement {
  return (
    <SidebarRow label={label}>
      <span
        className={cn(
          "min-w-0 truncate tabular-nums",
          value === null && "text-agent-console-muted",
        )}
      >
        {value ?? NOT_REPORTED}
      </span>
    </SidebarRow>
  );
}

/**
 * The block "Verbrauch": the tokens the selected attempt's session
 * processed, summed over its turns.
 * @remarks
 * The four rows stand from the start, so the session block below does not
 * move when the counts arrive. A reported 0 stays 0. The counts are the
 * adapter's own; Pages adds no cache count to the input. Antigravity reports
 * no charge, so a cost row appears only with an estimate from a catalog
 * price, which needs complete counts of every turn.
 */
function UsageSection({
  usage,
  isAfterTurn,
}: {
  readonly usage: AntigravityUsageTotal;
  readonly isAfterTurn: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const title = t(`${USAGE_KEY}.title`);
  const numbers = new Intl.NumberFormat(i18n.language);
  const currency = new Intl.NumberFormat(i18n.language, ESTIMATE_FORMAT);
  return (
    <section aria-label={title} data-console-usage="" className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={SIDEBAR_TITLE_CLASS}>{title}</h3>
        {isAfterTurn ? (
          <span className="min-w-0 truncate text-[13px] text-agent-console-muted">
            {t(`${USAGE_KEY}.afterTurn`)}
          </span>
        ) : null}
      </div>
      <dl className="mt-1">
        {USAGE_ROWS.map((field) => {
          const count = usage[field];
          return (
            <UsageRow
              key={field}
              label={t(`${USAGE_KEY}.${field}`)}
              value={count === null ? null : numbers.format(count)}
            />
          );
        })}
        {usage.amountUsd === null ? null : (
          <UsageRow
            label={t(`${USAGE_KEY}.costEstimate`)}
            value={currency.format(usage.amountUsd)}
          />
        )}
      </dl>
    </section>
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
 * session. An Antigravity attempt shows its summed usage between context
 * and session, so the occupancy of the window and the tokens the session
 * processed stand apart. The todo list takes the remaining room. A
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
        <UsageSection
          usage={props.view.antigravity.attempt}
          isAfterTurn={isWaitingForTurnEnd(props.step, props.view)}
        />
      ) : null}
      <SessionSection {...props} />
    </aside>
  );
}
