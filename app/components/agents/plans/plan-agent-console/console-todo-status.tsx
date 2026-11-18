import { Check, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

/**
 * A read-only status mark of a todo: an 18 px square with a spoken label.
 * @remarks
 * Done, in progress and failed fill the square with their `plan-todo` color
 * and carry a white 12 px sign: a check, two turning arrows or a cross. The
 * arrows turn once in 1.2 s and stand still where the reader asks for less
 * motion. An open entry is an empty square with a 1.5 px border.
 */
export function ConsoleTodoStatus({
  status,
}: {
  readonly status: AgentPlanProgressItem["status"];
}): React.ReactElement {
  const { t } = useTranslation();
  const isOpen =
    status !== "done" && status !== "active" && status !== "failed";
  return (
    <span
      role="img"
      aria-label={t(`plans.console.terminal.sidebar.todoStatus.${status}`)}
      data-todo-mark={status}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-sm text-plan-todo-label",
        status === "done" && "bg-plan-todo-done",
        status === "active" && "bg-plan-todo-active",
        status === "failed" && "bg-plan-todo-failed",
        isOpen && "border-[1.5px] border-border",
      )}
    >
      {status === "done" ? (
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : null}
      {status === "active" ? (
        <RefreshCw
          aria-hidden="true"
          data-todo-spinner=""
          className="size-3 motion-safe:animate-todo-spin"
          strokeWidth={2.8}
        />
      ) : null}
      {status === "failed" ? (
        <X aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : null}
    </span>
  );
}
