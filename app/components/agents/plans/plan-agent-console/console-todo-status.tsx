import { Check, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

/** A read-only status mark with a spoken label and centered, contrasting symbols. */
export function ConsoleTodoStatus({
  status,
}: {
  readonly status: AgentPlanProgressItem["status"];
}): React.ReactElement {
  const { t } = useTranslation();
  const isNeutral =
    status !== "done" && status !== "active" && status !== "failed";
  return (
    <span
      role="img"
      aria-label={t(`plans.console.terminal.sidebar.todoStatus.${status}`)}
      data-todo-mark={status}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] text-plan-todo-label",
        status === "done" && "bg-plan-todo-done",
        status === "active" && "bg-plan-todo-active",
        status === "failed" && "bg-plan-todo-failed",
        isNeutral && "border border-agent-console-muted",
      )}
    >
      {status === "done" ? (
        <Check
          aria-hidden="true"
          className="size-3"
          viewBox="0 -0.5 24 24"
          strokeWidth={3}
        />
      ) : null}
      {status === "active" ? (
        <RefreshCw
          aria-hidden="true"
          className="size-3 origin-center motion-safe:animate-spin"
          strokeWidth={2.5}
        />
      ) : null}
      {status === "failed" ? (
        <X aria-hidden="true" className="size-3.5" strokeWidth={3} />
      ) : null}
    </span>
  );
}
