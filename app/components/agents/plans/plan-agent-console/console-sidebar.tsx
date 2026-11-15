import { useTranslation } from "react-i18next";

import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { ClaudeUsageDetails } from "../claude-usage-details";

import { hasSessionEnded, infrastructureRestarts } from "./console-step-state";
import { formatClock } from "./console-time";
import { ConsoleTodoList } from "./console-todo-list";
import { OpenCodeUsageSection } from "./open-code-usage-section";
import { useNow } from "./use-terminal-surface";

import { CodexUsageFacts } from "../codex-usage-facts";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentSessionContextUsage,
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

function contextValueText(
  context: AgentSessionContextUsage,
  unknown: string,
  numbers: Intl.NumberFormat,
): string {
  const { contextUsed, contextLimit } = context;
  if (contextUsed === null) return unknown;
  const limit = contextLimit === null ? unknown : numbers.format(contextLimit);
  return `${numbers.format(contextUsed)} / ${limit}`;
}

function costText(
  context: AgentSessionContextUsage,
  unknown: string,
  language: string,
): string {
  if (!context.cost) return unknown;
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: context.cost.currency,
  }).format(context.cost.amount);
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
  const { context } = props.view;
  const share = contextShare(context);
  const contextValue = contextValueText(context, unknown, numbers);
  const codex =
    props.view.provider === "codex_cli"
      ? props.view.codexRunUsage?.steps.find(
          (step) => step.stepId === props.view.key.stepId,
        )
      : null;
  const totals = props.view.nodeTotals ?? props.view.totals;
  const known = totals.flatMap((total) =>
    total.totalTokens === null ? [] : [total.totalTokens],
  );
  const tokens =
    known.length === 0
      ? unknown
      : numbers.format(known.reduce((sum, value) => sum + value, 0));
  const cost = costText(context, unknown, i18n.language);
  return (
    <SidebarSection title={t(`${key}.usage`)}>
      {codex ? <CodexUsageFacts usage={codex.usage} /> : null}
      <dl className="space-y-1.5">
        <Fact label={t(`${key}.context`)} value={contextValue} />
        <div
          role="meter"
          aria-label={t(`${key}.context`)}
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
        <Fact
          label={t(`${key}.tokens`)}
          value={
            props.isTurnRunning && props.view.provider !== "codex_cli"
              ? t(`${key}.afterTurn`)
              : tokens
          }
        />
        {codex ? null : <Fact label={t(`${key}.cost`)} value={cost} />}
      </dl>
      {props.view.claudeUsage ? (
        <ClaudeUsageDetails usage={props.view.claudeUsage} />
      ) : (
        <dl className="space-y-1.5">
          <Fact
            label={t(`${key}.tokens`)}
            value={props.isTurnRunning ? t(`${key}.afterTurn`) : tokens}
          />
          <Fact label={t(`${key}.cost`)} value={cost} />
        </dl>
      )}
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
      <SessionSection step={props.step} view={props.view} />
    </aside>
  );
}
