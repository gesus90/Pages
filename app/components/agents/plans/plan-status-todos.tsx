import { Check, CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import { planTodoSummary } from "./plan-status-todo-model";
import { PlanStatusWork } from "./plan-status-work";

import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

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
      <ScrollViewport
        axis="vertical"
        tabIndex={0}
        aria-label={t("plans.progress.todoList")}
        containerClassName="min-h-20 max-h-80 min-w-0 flex-1"
        className="overflow-y-auto overscroll-contain pr-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
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
      </ScrollViewport>
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

function TodoRow({
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
