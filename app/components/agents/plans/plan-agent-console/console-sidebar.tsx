import { useTranslation } from "react-i18next";

import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { hasSessionEnded, infrastructureRestarts } from "./console-step-state";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";
import type {
  AgentSessionContextUsage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

interface ConsoleSidebarProps {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
}

/** The symbol and color of a todo: done green, active orange, open grey. */
const TODO_MARKS: Readonly<
  Record<"done" | "active" | "open", { symbol: string; className: string }>
> = {
  done: { symbol: "✓", className: "text-agent-terminal-success" },
  active: { symbol: "●", className: "text-agent-terminal-accent" },
  open: { symbol: "○", className: "text-agent-console-muted" },
};

function markOf(
  status: AgentPlanProgressItem["status"],
): (typeof TODO_MARKS)["open"] {
  if (status === "done" || status === "active") return TODO_MARKS[status];
  return TODO_MARKS.open;
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

function TodoList({
  todos,
}: {
  readonly todos: readonly AgentPlanProgressItem[];
}): React.ReactElement {
  const { t } = useTranslation();
  const done = todos.filter((todo) => todo.status === "done").length;
  return (
    <SidebarSection
      title={t("plans.console.terminal.sidebar.todos", {
        done,
        total: todos.length,
      })}
    >
      {todos.length === 0 ? (
        <p className="text-sm text-agent-console-muted">
          {t("plans.console.terminal.sidebar.noTodos")}
        </p>
      ) : (
        <ul className="space-y-1 text-sm text-agent-console-foreground">
          {todos.map((todo) => {
            const mark = markOf(todo.status);
            return (
              <li key={todo.id} className="flex min-w-0 gap-1.5">
                <span aria-hidden="true" className={mark.className}>
                  {mark.symbol}
                </span>
                <span className="sr-only">
                  {t(
                    `plans.console.terminal.sidebar.todoStatus.${todo.status}`,
                  )}
                </span>
                <span className="min-w-0 truncate" title={todo.text}>
                  {todo.contractId ? `${todo.contractId} ` : ""}
                  {todo.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarSection>
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

function UsageSection(props: {
  readonly view: AgentSessionView;
  /** A turn runs now: its tokens arrive with its end. */
  readonly isTurnRunning: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const numbers = new Intl.NumberFormat(i18n.language);
  const { context } = props.view;
  const share = contextShare(context);
  const used = context.contextUsed;
  const contextValue =
    used === null
      ? unknown
      : `${numbers.format(used)} / ${context.contextLimit === null ? unknown : numbers.format(context.contextLimit)}`;
  const totals = props.view.nodeTotals ?? props.view.totals;
  const known = totals.flatMap((total) =>
    total.totalTokens === null ? [] : [total.totalTokens],
  );
  const tokens =
    known.length === 0
      ? unknown
      : numbers.format(known.reduce((sum, value) => sum + value, 0));
  const cost = context.cost
    ? new Intl.NumberFormat(i18n.language, {
        style: "currency",
        currency: context.cost.currency,
      }).format(context.cost.amount)
    : unknown;
  return (
    <SidebarSection title={t(`${key}.usage`)}>
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
          value={props.isTurnRunning ? t(`${key}.afterTurn`) : tokens}
        />
        <Fact label={t(`${key}.cost`)} value={cost} />
      </dl>
    </SidebarSection>
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
 * The sidebar of the Pages terminal: todos, activity, usage and session (PAGE-284).
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
      className="shrink-0 space-y-5 overflow-y-auto border-t border-agent-console-border bg-agent-console-surface px-5 pt-5 pb-8 min-[680px]:w-[360px] min-[680px]:border-t-0 min-[680px]:border-l min-[680px]:pb-28"
    >
      <TodoList todos={props.step.progress?.todos ?? []} />
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
