import { useTranslation } from "react-i18next";

import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { ClaudeUsageDetails } from "../claude-usage-details";

import { hasSessionEnded, infrastructureRestarts } from "./console-step-state";
import { AntigravityUsageSection } from "./antigravity-usage-section";
import { formatClock } from "./console-time";
import { ConsoleTodoList } from "./console-todo-list";
import { OpenCodeUsageSection } from "./open-code-usage-section";
import { useNow } from "./use-terminal-surface";

import { CodexUsageFacts } from "../codex-usage-facts";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionContextUsage,
  AgentSessionUsageTotal,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

interface ConsoleSidebarProps {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
}

function SidebarSection(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold text-agent-console-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Fact(props: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-agent-console-muted">{props.label}</dt>
      <dd className="min-w-0 truncate text-right text-agent-console-foreground">
        {props.value}
      </dd>
    </div>
  );
}

/** What the agent does now: its own report, its ACP plan, or where the node stands. */
function activityText(
  step: AgentPlanStepResult,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const key = "plans.console.terminal.sidebar";
  if (step.status === "succeeded") return t(`${key}.activityDone`);
  if (step.status === "failed" || step.status === "cancelled")
    return t(`${key}.activityStopped`);
  if (step.session?.retry?.state === "waiting")
    return t(`${key}.activityWaiting`);
  return (
    step.progress?.activity?.text ??
    step.session?.activity?.titles[0] ??
    t(`${key}.noActivity`)
  );
}

function contextShare(context: AgentSessionContextUsage): number | null {
  const { contextUsed, contextLimit } = context;
  if (contextUsed === null || contextLimit === null || contextLimit <= 0)
    return null;
  return Math.min(100, (contextUsed / contextLimit) * 100);
}

function openRouterCost(
  total: AgentSessionUsageTotal | null,
  language: string,
  labels: {
    readonly free: string;
    readonly unknown: string;
    readonly missing: string;
  },
): string {
  if (!total) return labels.missing;
  if (total.costState === "free") return labels.free;
  if (
    total.costState === "unknown" ||
    total.costAmount === null ||
    total.costAmount === undefined
  )
    return labels.unknown;
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  }).format(total.costAmount);
}

function usageCount(
  count: number | null | undefined,
  numbers: Intl.NumberFormat,
  missing: string,
): string {
  return count === null || count === undefined
    ? missing
    : numbers.format(count);
}

function formatStandardCost(
  context: AgentSessionContextUsage,
  language: string,
  unknown: string,
): string {
  if (!context.cost) return unknown;
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: context.cost.currency,
  }).format(context.cost.amount);
}

function formatTurnTokens(options: {
  readonly totals: readonly AgentSessionUsageTotal[];
  readonly isOpenRouter: boolean;
  readonly isTurnRunning: boolean;
  readonly openRouterTotal: AgentSessionUsageTotal | null;
  readonly numbers: Intl.NumberFormat;
  readonly labels: {
    readonly afterTurn: string;
    readonly missing: string;
    readonly unknown: string;
  };
}): string {
  if (options.isTurnRunning && !options.isOpenRouter)
    return options.labels.afterTurn;
  if (options.isOpenRouter && !options.openRouterTotal)
    return options.labels.missing;
  const known = options.totals.flatMap((total) =>
    total.totalTokens === null ? [] : [total.totalTokens],
  );
  if (known.length === 0) return options.labels.unknown;
  return options.numbers.format(known.reduce((sum, value) => sum + value, 0));
}

function OpenRouterUsageFacts({
  openRouterTotal,
  view,
  numbers,
  language,
  costLabels,
}: {
  readonly openRouterTotal: AgentSessionUsageTotal | null;
  readonly view: AgentSessionView;
  readonly numbers: Intl.NumberFormat;
  readonly language: string;
  readonly costLabels: {
    readonly free: string;
    readonly unknown: string;
    readonly missing: string;
  };
}): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const missing = costLabels.missing;
  const runTotal = view.openRouterRunTotal ?? null;
  return (
    <>
      <Fact
        label={t(`${key}.inputTokens`)}
        value={usageCount(openRouterTotal?.inputTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.outputTokens`)}
        value={usageCount(openRouterTotal?.outputTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.reasoningTokens`)}
        value={usageCount(openRouterTotal?.reasoningTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.cacheReadTokens`)}
        value={usageCount(openRouterTotal?.cacheReadTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.cacheWriteTokens`)}
        value={usageCount(openRouterTotal?.cacheWriteTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.runTokens`)}
        value={usageCount(runTotal?.totalTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.runCost`)}
        value={openRouterCost(runTotal, language, costLabels)}
      />
      <Fact
        label={t(`${key}.runInputTokens`)}
        value={usageCount(runTotal?.inputTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.runOutputTokens`)}
        value={usageCount(runTotal?.outputTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.runReasoningTokens`)}
        value={usageCount(runTotal?.reasoningTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.runCacheReadTokens`)}
        value={usageCount(runTotal?.cacheReadTokens, numbers, missing)}
      />
      <Fact
        label={t(`${key}.runCacheWriteTokens`)}
        value={usageCount(runTotal?.cacheWriteTokens, numbers, missing)}
      />
      {view.isOpenRouterRunIncomplete ? (
        <p className="text-xs text-muted-foreground">
          {t(`${key}.incomplete`)}
        </p>
      ) : null}
    </>
  );
}

function findCodexStep(
  view: AgentSessionView,
): NonNullable<AgentSessionView["codexRunUsage"]>["steps"][number] | null {
  if (view.provider !== "codex_cli") return null;
  return (
    view.codexRunUsage?.steps.find((step) => step.stepId === view.key.stepId) ??
    null
  );
}

function isOpenRouterView(view: AgentSessionView): boolean {
  return (
    view.provider === "opencode" &&
    view.model.requestedModel.value?.startsWith("openrouter/") === true
  );
}

function ContextMeter({
  context,
  label,
  unknown,
  numbers,
}: {
  readonly context: AgentSessionContextUsage;
  readonly label: string;
  readonly unknown: string;
  readonly numbers: Intl.NumberFormat;
}): React.ReactElement {
  const share = contextShare(context);
  const used = context.contextUsed;
  const contextLimit =
    context.contextLimit === null
      ? unknown
      : numbers.format(context.contextLimit);
  const contextValue =
    used === null ? unknown : `${numbers.format(used)} / ${contextLimit}`;
  return (
    <>
      <Fact label={label} value={contextValue} />
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share === null ? undefined : Math.round(share)}
        className="h-1 overflow-hidden rounded-full bg-agent-console-track"
      >
        <div
          className="h-full rounded-full bg-agent-terminal-accent"
          style={{ width: `${share ?? 0}%` }}
        />
      </div>
    </>
  );
}

function UsageSection(props: {
  readonly view: AgentSessionView;
  /** A turn runs now: its tokens arrive with its end. */
  readonly isTurnRunning: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  if (props.view.openCode)
    return <OpenCodeUsageSection {...props.view.openCode} />;
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const numbers = new Intl.NumberFormat(i18n.language);
  const codex = findCodexStep(props.view);
  const totals = props.view.nodeTotals ?? props.view.totals;
  const isOpenRouter = isOpenRouterView(props.view);
  const openRouterTotal = isOpenRouter ? (totals[0] ?? null) : null;
  const costLabels = {
    free: t(`${key}.free`),
    unknown: t(`${key}.priceUnknown`),
    missing: t(`${key}.notReported`),
  };
  const tokens = formatTurnTokens({
    totals,
    isOpenRouter,
    isTurnRunning: props.isTurnRunning && props.view.provider !== "codex_cli",
    openRouterTotal,
    numbers,
    labels: {
      afterTurn: t(`${key}.afterTurn`),
      missing: costLabels.missing,
      unknown,
    },
  });
  const cost = isOpenRouter
    ? openRouterCost(openRouterTotal, i18n.language, costLabels)
    : formatStandardCost(props.view.context, i18n.language, unknown);
  const costLabelKey =
    props.view.provider === "antigravity"
      ? `${key}.antigravity.providerCost`
      : `${key}.cost`;
  return (
    <SidebarSection title={t(`${key}.usage`)}>
      {codex ? <CodexUsageFacts usage={codex.usage} /> : null}
      <dl className="space-y-1.5">
        <ContextMeter
          context={props.view.context}
          label={t(`${key}.context`)}
          unknown={unknown}
          numbers={numbers}
        />
        <Fact label={t(`${key}.tokens`)} value={tokens} />
        {codex ? null : <Fact label={t(costLabelKey)} value={cost} />}
        {isOpenRouter ? (
          <OpenRouterUsageFacts
            openRouterTotal={openRouterTotal}
            view={props.view}
            numbers={numbers}
            language={i18n.language}
            costLabels={costLabels}
          />
        ) : null}
      </dl>
      {props.view.claudeUsage ? (
        <ClaudeUsageDetails usage={props.view.claudeUsage} />
      ) : null}
    </SidebarSection>
  );
}

/** How long the session of the node ran, ticking while it runs, else up to its end (PAGE-289). */
function RuntimeFact({
  step,
  label,
  unknown,
}: {
  readonly step: AgentPlanStepResult;
  readonly label: string;
  readonly unknown: string;
}): React.ReactElement {
  const startedAt = Date.parse(step.session?.startedAt ?? "");
  const endedAt = Date.parse(
    step.session?.endedAt ?? step.session?.turnEndedAt ?? "",
  );
  const isRunning =
    Number.isFinite(startedAt) &&
    !step.session?.endedAt &&
    !hasSessionEnded(step);
  const now = useNow(isRunning);
  const end = isRunning ? now : endedAt;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-agent-console-muted">{label}</dt>
      <dd className="text-right text-agent-console-foreground tabular-nums">
        {Number.isFinite(startedAt) && Number.isFinite(end)
          ? formatClock(end - startedAt)
          : unknown}
      </dd>
    </div>
  );
}

function SessionSection(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const requested = props.step.session?.requested;
  const { model, workspace } = props.view;
  const access = requested?.options?.access;
  const git = workspace?.git;
  return (
    <SidebarSection title={t(`${key}.session`)}>
      <dl className="space-y-1.5">
        <RuntimeFact
          step={props.step}
          label={t(`${key}.runtime`)}
          unknown={unknown}
        />
        <Fact
          label={t(`${key}.model`)}
          value={model.confirmedModel.value ?? requested?.model ?? unknown}
        />
        <Fact
          label={t(`${key}.reasoning`)}
          value={
            model.confirmedReasoning.value ??
            requested?.reasoningEffort ??
            unknown
          }
        />
        <Fact
          label={t(`${key}.access`)}
          value={access ? t(`${key}.accessMode.${access}`) : unknown}
        />
        <Fact
          label={t(`${key}.branch`)}
          value={git?.state === "branch" ? git.branch : unknown}
        />
        <Fact
          label={t(`${key}.restarts`)}
          value={`${infrastructureRestarts(props.step)} / ${PLAN_BLOCKER_RETRIES.infrastructure}`}
        />
      </dl>
    </SidebarSection>
  );
}

/**
 * The sidebar of the Pages terminal: todos, activity, usage and session (PAGE-284, PAGE-289).
 *
 * @remarks
 * It follows the run while it runs: the todos and the activity come from the
 * progress projection of the plan, the usage from the session. A value a
 * provider does not report reads as unknown, never as 0. Its bottom padding
 * keeps the last line above Pica's symbol, also in a low window.
 */
export function ConsoleSidebar(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t("plans.console.details")}
      className="min-w-0 shrink-0 space-y-5 overflow-y-auto border-t border-agent-console-border bg-agent-console-surface px-5 pt-5 pb-8 min-[680px]:w-[300px] min-[680px]:border-t-0 min-[680px]:border-l min-[680px]:pb-28"
    >
      <ConsoleTodoList step={props.step} />
      <SidebarSection title={t("plans.console.terminal.sidebar.activity")}>
        <p className="text-sm text-agent-console-muted">
          {activityText(props.step, t)}
        </p>
      </SidebarSection>
      <UsageSection
        view={props.view}
        isTurnRunning={
          props.view.state === "running" && !hasSessionEnded(props.step)
        }
      />
      <AntigravityUsageSection view={props.view} />
      <SessionSection step={props.step} view={props.view} />
    </aside>
  );
}
