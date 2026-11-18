import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

/**
 * A read-only status mark of a todo: a 14 px circle with a spoken label.
 * @remarks
 * Done is a check on the success color, the current entry a primary dot
 * inside a primary ring, an open entry a ring in the muted color. A failed
 * entry keeps a cross on the destructive color.
 */
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
        "flex size-3.5 shrink-0 items-center justify-center rounded-full",
        status === "done" && "bg-success text-agent-console-surface",
        status === "active" && "border-[1.5px] border-primary",
        status === "failed" && "bg-destructive text-agent-console-surface",
        isNeutral && "border-[1.5px] border-agent-console-muted",
      )}
    >
      {status === "done" ? (
        <Check aria-hidden="true" className="size-2.5" strokeWidth={3.5} />
      ) : null}
      {status === "active" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
      ) : null}
      {status === "failed" ? (
        <X aria-hidden="true" className="size-2.5" strokeWidth={3.5} />
      ) : null}
    </span>
  );
}
