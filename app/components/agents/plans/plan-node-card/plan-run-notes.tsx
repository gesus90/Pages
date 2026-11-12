import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

const BADGE_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium";

/** The name of a node a run result mentions; never its identifier. */
function useRunNodeName(): (id: string) => string {
  const { t } = useTranslation();
  const { draft, sources, run } = usePlanFlowContext();
  return (id) => {
    const node = draft.nodes.find((entry) => entry.id === id);
    if (node) return planNodeLabel(node, sources);
    return (
      run?.steps.find((step) => step.id === id)?.name ??
      t("plans.run.unknownNode")
    );
  };
}

/** Whether a result has anything to say beyond its status: a later start, a boolean result or an event. */
export function hasPlanRunNotes(
  result: AgentPlanStepResult | undefined,
): boolean {
  if (!result) return false;
  return (
    result.skipped === true ||
    (result.activation ?? 1) > 1 ||
    result.passed !== undefined ||
    result.trigger !== undefined
  );
}

/**
 * What a run adds to a card once nodes can start again: the number of the
 * start, the boolean result of an agent and the event that started it.
 *
 * @remarks
 * Nothing shows for a node that ran once without a decision or an event, so
 * plans without them look as before. Every note is words, never colour alone.
 */
export function PlanRunNotes(props: {
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const nodeName = useRunNodeName();
  const { result } = props;
  if (!result || !hasPlanRunNotes(result)) return null;
  const activation = result.activation ?? 1;
  const sources = result.trigger?.sources ?? [];
  return (
    <div
      data-plan-run-notes=""
      className={cn("flex flex-wrap items-center gap-1", PLAN_NODE_TEXT.meta)}
    >
      {result.skipped === true ? (
        <span
          data-plan-skipped=""
          className={cn(
            BADGE_CLASS,
            "border-success/40 bg-success-subtle text-success",
          )}
        >
          <Check aria-hidden="true" className="size-3" />
          {t("plans.run.skipped")}
        </span>
      ) : null}
      {activation > 1 ? (
        <span
          data-plan-activation={activation}
          className={cn(
            BADGE_CLASS,
            "border-border bg-muted text-muted-foreground",
          )}
        >
          {t("plans.run.activation", { number: activation })}
        </span>
      ) : null}
      {result.passed === undefined ? null : (
        <PassedBadge isPassed={result.passed} />
      )}
      <SessionBadge role={result.session?.event?.role} />
      {sources.length > 0 ? (
        <span data-plan-trigger="" className="w-full text-info">
          {t("plans.run.triggeredBy", {
            names: sources.map((source) => nodeName(source.stepId)).join(", "),
          })}
        </span>
      ) : null}
    </div>
  );
}

/** Whether an agent that started again went on in its session or in a new one, so a recovery is never taken for the same session. */
function SessionBadge(props: {
  readonly role: "created" | "continued" | "recovered" | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { role } = props;
  if (role !== "continued" && role !== "recovered") return null;
  return (
    <span
      data-plan-session={role}
      className={cn(
        BADGE_CLASS,
        role === "recovered"
          ? "border-warning/40 bg-warning-subtle text-warning"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {t(
        role === "recovered"
          ? "plans.run.sessionRecovered"
          : "plans.run.sessionContinued",
      )}
    </span>
  );
}

/** The boolean result of an agent, as a word and a mark. */
function PassedBadge(props: {
  readonly isPassed: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const Mark = props.isPassed ? Check : X;
  return (
    <span
      data-plan-passed={String(props.isPassed)}
      className={cn(
        BADGE_CLASS,
        props.isPassed
          ? "border-success/40 bg-success-subtle text-success"
          : "border-warning/40 bg-warning-subtle text-warning",
      )}
    >
      <Mark aria-hidden="true" className="size-3" />
      {t(props.isPassed ? "plans.run.passed" : "plans.run.notPassed")}
    </span>
  );
}
