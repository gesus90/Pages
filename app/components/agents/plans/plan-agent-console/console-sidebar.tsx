import { useTranslation } from "react-i18next";

import { modelBadgeVendor } from "@/definition/AgentModelIdentity";
import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { hasSessionEnded, infrastructureRestarts } from "./console-step-state";
import { AntigravityUsageSection } from "./antigravity-usage-section";
import { formatClock } from "./console-time";
import { ConsoleContextSection } from "./console-context-section";
import { ConsoleTodoList } from "./console-todo-list";
import { BadgeSessionFacts, workspaceName } from "./console-session-badges";
import { Fact, SidebarRow, SidebarSection } from "./console-sidebar-parts";
import { OpenCodeUsageSection } from "./open-code-usage-section";
import { useNow } from "./use-terminal-surface";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionContextUsage,
  AgentSessionUsageTotal,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

/**
 * The providers whose console usage is only the context occupancy: Claude
 * Code and Codex. Antigravity keeps its token, cost and reference facts
 * beside its model badges.
 */
const CONTEXT_ONLY_USAGE_PROVIDERS: ReadonlySet<string> = new Set([
  "claude_code",
  "codex_cli",
]);

interface ConsoleSidebarProps {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
}

/** One compact usage fact of a provider with token and cost reports. */
function UsageFact(props: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <dt className="text-agent-console-muted">{props.label}</dt>
      <dd className="min-w-0 truncate text-right text-agent-console-foreground">
        {props.value}
      </dd>
    </div>
  );
}

/**
 * What the agent does now while the step runs: its own report, its ACP plan,
 * or a wait for a restart; `null` for a step that ended or names nothing.
 */
function activityText(
  step: AgentPlanStepResult,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (step.status !== "running") return null;
  if (step.session?.retry?.state === "waiting")
    return t("plans.console.terminal.sidebar.activityWaiting");
  return (
    step.progress?.activity?.text ?? step.session?.activity?.titles[0] ?? null
  );
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
      <UsageFact
        label={t(`${key}.inputTokens`)}
        value={usageCount(openRouterTotal?.inputTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.outputTokens`)}
        value={usageCount(openRouterTotal?.outputTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.reasoningTokens`)}
        value={usageCount(openRouterTotal?.reasoningTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.cacheReadTokens`)}
        value={usageCount(openRouterTotal?.cacheReadTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.cacheWriteTokens`)}
        value={usageCount(openRouterTotal?.cacheWriteTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.runTokens`)}
        value={usageCount(runTotal?.totalTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.runCost`)}
        value={openRouterCost(runTotal, language, costLabels)}
      />
      <UsageFact
        label={t(`${key}.runInputTokens`)}
        value={usageCount(runTotal?.inputTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.runOutputTokens`)}
        value={usageCount(runTotal?.outputTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.runReasoningTokens`)}
        value={usageCount(runTotal?.reasoningTokens, numbers, missing)}
      />
      <UsageFact
        label={t(`${key}.runCacheReadTokens`)}
        value={usageCount(runTotal?.cacheReadTokens, numbers, missing)}
      />
      <UsageFact
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

function isOpenRouterView(view: AgentSessionView): boolean {
  return (
    view.provider === "opencode" &&
    view.model.requestedModel.value?.startsWith("openrouter/") === true
  );
}

interface UsageSectionProps {
  readonly view: AgentSessionView;
  /** A turn runs now: its tokens arrive with its end. */
  readonly isTurnRunning: boolean;
}

/**
 * The token and cost reports of a provider that has them; the context
 * occupancy is the block of its own above.
 */
function UsageSection(props: UsageSectionProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (CONTEXT_ONLY_USAGE_PROVIDERS.has(props.view.provider)) return null;
  if (props.view.openCode)
    return <OpenCodeUsageSection {...props.view.openCode} />;
  return (
    <SidebarSection title={t("plans.console.terminal.sidebar.usage")}>
      <UsageFacts view={props.view} isTurnRunning={props.isTurnRunning} />
    </SidebarSection>
  );
}

function UsageFacts(props: UsageSectionProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const numbers = new Intl.NumberFormat(i18n.language);
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
    isTurnRunning: props.isTurnRunning,
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
    <dl className="mt-1.5 space-y-1.5">
      <UsageFact label={t(`${key}.tokens`)} value={tokens} />
      <UsageFact label={t(costLabelKey)} value={cost} />
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
  );
}

/** How long the session of the node ran, ticking while it runs, else up to its end. */
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
    <SidebarRow label={label}>
      <span className="tabular-nums">
        {Number.isFinite(startedAt) && Number.isFinite(end)
          ? formatClock(end - startedAt)
          : unknown}
      </span>
    </SidebarRow>
  );
}

function SessionSection(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const vendor = modelBadgeVendor(props.view.provider);
  return (
    <SidebarSection title={t(`${key}.session`)}>
      <dl className="mt-1">
        <RuntimeFact
          step={props.step}
          label={t(`${key}.runtime`)}
          unknown={unknown}
        />
        {vendor ? (
          <BadgeSessionFacts
            step={props.step}
            view={props.view}
            vendor={vendor}
          />
        ) : (
          <GenericSessionFacts step={props.step} view={props.view} />
        )}
        <Fact
          label={t(`${key}.workspace`)}
          value={workspaceName(props.view) ?? unknown}
        />
        <Fact
          label={t(`${key}.restarts`)}
          value={`${infrastructureRestarts(props.step)} / ${PLAN_BLOCKER_RETRIES.infrastructure}`}
        />
      </dl>
    </SidebarSection>
  );
}

/** Model, reasoning, access and branch of every provider without model badges, as text. */
function GenericSessionFacts(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const requested = props.step.session?.requested;
  const { model, workspace } = props.view;
  const access = requested?.options?.access;
  const git = workspace?.git;
  return (
    <>
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
    </>
  );
}

/**
 * The sidebar of the Pages terminal: the blocks To Do, Kontext and Session.
 * @remarks
 * It follows the run while it runs: the todos and the activity come from the
 * progress projection of the plan, the context from the session. A value a
 * provider does not report reads as unknown, never as 0. Providers with
 * token and cost reports add them after the context. Blocks stand 14 px
 * apart with a 1 px divider. Its bottom padding keeps the last line above
 * Pica's symbol, also in a low window.
 */
export function ConsoleSidebar(props: ConsoleSidebarProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t("plans.console.details")}
      className="min-w-0 shrink-0 overflow-y-auto border-t border-agent-console-border bg-agent-console-surface px-5 pt-5 [&>*+*]:mt-3.5 [&>*+*]:border-t [&>*+*]:border-agent-console-border [&>*+*]:pt-3.5 pb-8 min-[680px]:w-[300px] min-[680px]:border-t-0 min-[680px]:border-l min-[680px]:pb-28"
    >
      <ConsoleTodoList
        step={props.step}
        activity={activityText(props.step, t)}
      />
      <ConsoleContextSection view={props.view} />
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
