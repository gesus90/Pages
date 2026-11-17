import { Check, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PLAN_NODE_TEXT } from "../plan-node-text";

import type { AgentPlanSignalRun } from "@/definition/AgentPlanJump";

/**
 * What a signal node did with its message, in words and a mark.
 * @remarks
 * A signal that nobody received is no successful sending: it is shown as
 * not delivered, with the reason, however the node itself went on.
 */
export function PlanSignalRunLine(props: {
  readonly signal: AgentPlanSignalRun;
}): React.ReactElement {
  const { t } = useTranslation();
  const { signal } = props;
  const Mark = signal.delivered ? Check : TriangleAlert;
  return (
    <p
      data-plan-signal-run={signal.reason}
      className={cn(
        "flex items-start gap-1.5 rounded-md border px-2 py-1 font-medium",
        PLAN_NODE_TEXT.meta,
        signal.delivered
          ? "border-success/40 bg-success-subtle text-success"
          : "border-warning/40 bg-warning-subtle text-warning",
      )}
    >
      <Mark aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        {t(`plans.signal.run.${signal.reason}`, { name: signal.name })}
      </span>
    </p>
  );
}
