import { Check, CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type {
  AgentPlanProgress,
  AgentPlanProgressItem,
} from "@/definition/AgentPlanProgress";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanWorkView } from "@/definition/AgentPlanWork";

/** The existing detail panel's read-only checklist, scoped to the selected ticket and node. */
export function PlanStatusTodos({
  step,
  number,
}: {
  readonly step: AgentPlanStepResult;
  readonly number: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const progress = step.progress;
  const summary = planTodoSummary(step);
  const items = summary.tickets.length
    ? summary.items
    : (progress?.todos ?? []);
  const heading = [t("plans.progress.todoLabel"), summary.tickets.join(", ")]
    .filter(Boolean)
    .join(" · ");
  const isUnavailable = !progress || progress.availability === "unavailable";
  return (
    <section
      className="flex min-h-0 min-w-0 shrink-0 flex-col"
      aria-label={heading}
    >
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
          {heading}
        </h3>
        <span className="text-xs text-muted-foreground wrap-anywhere">
          {step.name} · {t("plans.progress.step", { number })}
        </span>
      </div>
      <p className="my-1 shrink-0 text-xs leading-4.5 text-muted-foreground tabular-nums">
        {summary.isConfirmed
          ? t("plans.progress.todoSummary", {
              completed: summary.completed,
              active: summary.active,
              open: summary.open,
            })
          : t("plans.progress.noTodos")}
      </p>
      {progress ? (
        <p className="mb-1 shrink-0 text-xs leading-4.5 text-muted-foreground">
          {t(
            `plans.progress.source.${progress.source === "live" && !summary.tickets.length ? "contract" : progress.source}`,
          )}
        </p>
      ) : null}
      <div>
        {items.length ? (
          <ul className="py-1">
            {items.map((item) => (
              <TodoRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-xs leading-4.5 text-muted-foreground">
            {t(
              isUnavailable
                ? "plans.progress.noTodos"
                : "plans.progress.emptyTodos",
            )}
          </p>
        )}
        <PlanStatusWork work={progress?.work} />
      </div>
    </section>
  );
}

function TodoStatusMark({
  status,
}: {
  readonly status: AgentPlanProgressItem["status"];
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-xs border",
        status === "done" &&
          "border-plan-todo-done bg-plan-todo-done text-plan-todo-label",
        status === "active" && "border-status-active bg-surface",
        status !== "done" && status !== "active" && "border-border bg-muted",
      )}
    >
      {status === "done" ? <Check className="size-3" strokeWidth={3} /> : null}
      {status === "active" ? (
        <span className="size-1 rounded-full bg-status-active" />
      ) : null}
    </span>
  );
}

/** One read-only row of a TODO list; the mark shows the state and nothing here can change it. */
export function TodoRow({
  item,
}: {
  readonly item: AgentPlanProgressItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const isUnknown = item.status === "missing" || item.status === "unreported";
  return (
    <li
      className={cn(
        "my-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs leading-4.5",
        item.status === "active" && "bg-status-active-subtle",
      )}
    >
      <TodoStatusMark status={item.status} />
      <span
        className={cn(
          "min-w-0 flex-1 wrap-anywhere",
          item.status === "active" && "font-semibold",
        )}
      >
        {item.text}
      </span>
      <span
        className={cn(
          "flex max-w-[40%] shrink-0 items-center gap-1 text-xs leading-4.5 wrap-anywhere",
          item.status === "done" && "text-plan-todo-done-text",
          item.status === "active" && "text-status-active",
          item.status !== "done" &&
            item.status !== "active" &&
            "text-muted-foreground",
        )}
      >
        {isUnknown ? (
          <CircleHelp aria-hidden="true" className="size-3" />
        ) : null}
        {t(`plans.progress.todoState.${item.status}`)}
      </span>
    </li>
  );
}

interface PlanTodoSummary {
  readonly items: readonly AgentPlanProgressItem[];
  readonly completed: number;
  readonly active: number;
  readonly open: number;
  readonly total: number;
  readonly isConfirmed: boolean;
  readonly tickets: readonly string[];
}

function isChecklistObserved(
  progress: AgentPlanProgress | undefined,
  items: readonly AgentPlanProgressItem[],
): boolean {
  if (progress?.availability !== "observed") return false;
  return items.every(
    (item) => item.status !== "missing" && item.status !== "unreported",
  );
}

function planTodoSummary(
  step: AgentPlanStepResult | undefined,
): PlanTodoSummary {
  const progress = step?.progress;
  const tickets = progress?.tickets ?? step?.session?.contract?.tickets ?? [];
  const items = (progress?.todos ?? []).filter(
    (item) =>
      item.ticket !== undefined ||
      tickets.some((ticket) => item.id.startsWith(`${ticket.id}:`)),
  );
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const completed = unique.filter((item) => item.status === "done").length;
  const active = unique.filter((item) => item.status === "active").length;
  return {
    items: unique,
    completed,
    active,
    open: unique.length - completed - active,
    total: unique.length,
    isConfirmed: tickets.length > 0 && isChecklistObserved(progress, unique),
    tickets: [...new Set(tickets.map((ticket) => ticket.key))],
  };
}

function PlanStatusWork({
  work,
}: {
  readonly work: readonly AgentPlanWorkView[] | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!work?.length) return null;
  return (
    <div className="space-y-2 border-t border-border pt-2 text-xs">
      {work.map((view) => (
        <div key={view.ticketId} className="space-y-1 wrap-anywhere">
          <p className="font-medium">
            {t("plans.workGate.scope", {
              ticket: view.ticketKey,
              revision: view.record?.revision ?? 0,
            })}
          </p>
          <p>
            {t(
              view.issues.length
                ? "plans.workGate.pending"
                : "plans.workGate.confirmed",
            )}
          </p>
          {view.record ? (
            <p className="text-muted-foreground">{view.record.note}</p>
          ) : null}
          {view.record?.scope
            .filter((item) => !item.relevant)
            .map((item) => (
              <p key={item.itemId} className="text-muted-foreground">
                {t("plans.workGate.excluded", {
                  title:
                    view.items.find((entry) => entry.id === item.itemId)
                      ?.text ?? item.itemId,
                  reason: item.reason,
                })}
              </p>
            ))}
          <ul className="space-y-1">
            {view.requiredChecks.map((name) => {
              const check = view.record?.checks.find(
                (entry) => entry.name === name,
              );
              return (
                <li key={name}>
                  {name} ·{" "}
                  {check
                    ? `${check.command} · Exit ${check.exitCode} · ${check.evidence}`
                    : t("plans.workGate.missingCheck")}
                </li>
              );
            })}
          </ul>
          {view.record?.proofs.map((proof) => (
            <p key={proof.itemId}>
              {view.items.find((item) => item.id === proof.itemId)?.text ??
                proof.itemId}
              : {proof.evidence}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
