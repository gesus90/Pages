import { Check, CircleHelp, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

const EMPTY_TODOS: readonly AgentPlanProgressItem[] = [];

/** A stable scroll window with fades only where more checklist content is hidden. */
export function PlanStatusTodos({
  step,
  number,
}: {
  readonly step: AgentPlanStepResult;
  readonly number: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const progress = step.progress;
  const items = progress?.todos ?? EMPTY_TODOS;
  return (
    <ScrollViewport
      as="section"
      axis="vertical"
      containerClassName="min-w-0 shrink-0 @2xl/status:min-h-0 @2xl/status:shrink"
      className="flex flex-col overflow-visible overscroll-contain @2xl/status:overflow-x-hidden @2xl/status:overflow-y-auto"
      aria-label={t("plans.progress.todos")}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <h3 className="text-sm leading-5 font-semibold">
          {t("plans.progress.todos")}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {progress
            ? t("plans.progress.todoCount", {
                completed: items.filter((item) => item.status === "done")
                  .length,
                total: items.length,
              })
            : "—"}
        </span>
      </div>
      <p className="mb-1 shrink-0 border-b border-border/80 pb-2 text-xs leading-4.5 text-muted-foreground wrap-anywhere">
        {step.name} · {t("plans.progress.step", { number })}
      </p>
      {progress ? (
        <p className="mb-1 shrink-0 text-xs leading-4.5 text-muted-foreground">
          {t(
            `plans.progress.source.${progress.source === "live" && !step.session?.contract?.tickets.length ? "contract" : progress.source}`,
          )}
        </p>
      ) : null}
      <div className="relative h-36 shrink-0 overflow-hidden @2xl/status:h-auto @2xl/status:min-h-20 @2xl/status:flex-1">
        <ScrollViewport
          axis="vertical"
          tabIndex={0}
          aria-label={t("plans.progress.todoList")}
          containerClassName="h-full max-h-80"
          className="overflow-y-auto overscroll-contain pr-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
        >
          <div className="min-h-full py-2">
            {items.length ? (
              <ul>
                {items.map((item) => (
                  <TodoRow key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              <p className="p-2 text-xs leading-4.5 text-muted-foreground">
                {t(
                  progress
                    ? "plans.progress.emptyTodos"
                    : "plans.progress.noTodos",
                )}
              </p>
            )}
          </div>
        </ScrollViewport>
      </div>
    </ScrollViewport>
  );
}

function TodoRow({
  item,
}: {
  readonly item: AgentPlanProgressItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const isDone = item.status === "done";
  const Icon = isDone ? Check : Square;
  return (
    <li className="flex items-start gap-2 border-b border-muted-foreground/15 py-1.5 text-xs leading-4.5">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[3px]",
          isDone
            ? "bg-plan-progress-done bg-linear-to-br from-plan-progress-shade/50 to-plan-progress-shade/35 text-plan-progress-label"
            : "text-muted-foreground",
        )}
      >
        <Icon aria-hidden="true" className="size-3" />
      </span>
      <span
        className={cn(
          "min-w-0 wrap-anywhere",
          isDone && "text-muted-foreground",
        )}
      >
        <span className="sr-only">
          {t(`plans.progress.todoState.${item.status}`)}:{" "}
        </span>
        {item.text}
        {item.status === "missing" || item.status === "unreported" ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <CircleHelp aria-hidden="true" className="size-3" />
            {t(`plans.progress.todoState.${item.status}`)}
          </span>
        ) : null}
      </span>
    </li>
  );
}
