import { Check, CircleHelp, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const progress = step.progress;
  const items = progress?.todos ?? EMPTY_TODOS;
  function measure(): void {
    const element = viewport.current;
    if (!element) return;
    setEdges({
      top: element.scrollTop > 1,
      bottom:
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
    });
  }
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items]);
  return (
    <section
      className="flex shrink-0 flex-col @3xl:min-h-0 @3xl:pl-9"
      aria-label={t("plans.progress.todos")}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold @3xl:text-2xl">
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
      <p className="mb-1 border-b border-border/80 pb-2 text-sm text-muted-foreground wrap-anywhere">
        {step.name} · {t("plans.progress.step", { number })}
      </p>
      {progress ? (
        <p className="mb-1 shrink-0 text-[10px] text-muted-foreground">
          {t(
            `plans.progress.source.${progress.source === "live" && !step.session?.contract?.tickets.length ? "contract" : progress.source}`,
          )}
        </p>
      ) : null}
      <div className="relative h-36 shrink-0 overflow-hidden @3xl:h-auto @3xl:min-h-0 @3xl:flex-1">
        <div
          ref={viewport}
          tabIndex={0}
          onScroll={measure}
          aria-label={t("plans.progress.todoList")}
          className="h-full max-h-80 overflow-y-auto overscroll-contain pr-2 [scrollbar-color:var(--color-muted-foreground)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
        >
          <div className="min-h-full py-2">
            {items.length ? (
              <ul>
                {items.map((item) => (
                  <TodoRow key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              <p className="p-2 text-sm text-muted-foreground">
                {t(
                  progress
                    ? "plans.progress.emptyTodos"
                    : "plans.progress.noTodos",
                )}
              </p>
            )}
          </div>
        </div>
        {edges.top ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-5 left-0 h-6 bg-linear-to-b from-plan-progress-surface to-transparent"
          />
        ) : null}
        {edges.bottom ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-5 bottom-0 left-0 h-6 bg-linear-to-t from-plan-progress-surface to-transparent"
          />
        ) : null}
      </div>
    </section>
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
    <li className="flex items-start gap-4 border-b border-muted-foreground/15 px-2 py-1.5 text-base leading-5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[3px]",
          isDone
            ? "bg-plan-progress-done bg-linear-to-br from-plan-progress-shade/50 to-plan-progress-shade/35 text-plan-progress-label"
            : "text-muted-foreground",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
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
