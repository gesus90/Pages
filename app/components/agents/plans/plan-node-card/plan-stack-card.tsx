import {
  CheckCircle2,
  CircleX,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { createRandomUuid } from "@/app/lib/random-uuid";
import { addPlanStackTicket } from "@/definition/AgentPlanStackEdit";
import { PLAN_STACK_ENTRY_COUNT } from "@/definition/AgentPlanStack";
import { planStackOutcome } from "@/definition/AgentPlanStackOutcome";

import { usePlanFlowContext } from "../plan-flow-context";
import { planNodeLabel } from "../plan-layout";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { planStackView } from "../plan-stack-summary";
import { PLAN_STATUS_MARKER, planStatusClass } from "../plan-status";
import {
  PlanCard,
  PlanCardColumns,
  PLAN_CARD_BODY,
  PLAN_CARD_HINT,
} from "./plan-card";
import { PlanStackEntries } from "./plan-stack-entries";
import { PlanStackFlowRow, PlanStackOutput } from "./plan-stack-ports";
import { PlanTicketPicker } from "./plan-ticket-picker";
import { usePlanStackFileDrop } from "./plan-stack-file-drop";

import type { AgentPlanStack } from "@/definition/AgentPlanStack";
import type { AgentPlanStackOutcome } from "@/definition/AgentPlanStackOutcome";
import type { PlanStackView } from "../plan-stack-summary";

/** The marker on the header edge: progress during a run, or that the stack is empty or used up. */
function StackBadge(props: {
  readonly view: PlanStackView;
  readonly hasRun: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { view } = props;
  if (!props.hasRun && view.state !== "empty") return null;
  const text =
    view.state === "ready"
      ? t("plans.stack.progress", {
          delivered: view.delivered,
          total: view.total,
        })
      : t(`plans.stack.state.${view.state}`);
  return (
    <span
      data-plan-stack-badge={view.state}
      role="status"
      className={cn(
        "inline-flex shrink-0 items-center border",
        PLAN_STATUS_MARKER,
        view.state === "ready"
          ? "border-plan-stack/40 bg-plan-stack-subtle text-plan-stack"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

/** The icon beside the processing state; color is never its only sign. */
const OUTCOME_ICONS = {
  processing: LoaderCircle,
  succeeded: CheckCircle2,
  open: TriangleAlert,
  failed: CircleX,
} as const;

/** The colors of the note on a processing outcome; the card itself keeps its type colors. */
function outcomeNoteClass(outcome: AgentPlanStackOutcome): string {
  if (outcome === "succeeded") return planStatusClass("succeeded");
  if (outcome === "open") return planStatusClass("succeeded", false, true);
  if (outcome === "failed") return planStatusClass("failed");
  return planStatusClass("running");
}

/**
 * How the processing of the handed-over entries stands, apart from the handovers.
 *
 * @remarks
 * Shown only once an entry was handed over; an empty, untriggered or
 * unprocessed stack keeps its handover state alone.
 */
function StackOutcomeNote(props: {
  readonly outcome: AgentPlanStackOutcome;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { outcome } = props;
  if (outcome === "none") return null;
  const Icon = OUTCOME_ICONS[outcome];
  return (
    <p
      role="status"
      data-plan-stack-outcome={outcome}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-semibold",
        PLAN_NODE_TEXT.meta,
        outcomeNoteClass(outcome),
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0",
          outcome === "processing" && "motion-safe:animate-spin",
        )}
      />
      <span className="truncate">{t(`plans.stack.outcome.${outcome}`)}</span>
    </p>
  );
}

/** The hint line of a stack: how many entries there are, how many were handed over and how many are left. */
function StackSummary(props: {
  readonly view: PlanStackView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { view } = props;
  return (
    <p data-plan-stack-summary="" className={PLAN_CARD_HINT}>
      {t("plans.stack.summary", {
        count: view.total,
        delivered: view.delivered,
        remaining: view.remaining,
      })}
    </p>
  );
}

/** Adds a ticket of the plan's project as the last entry. */
function StackTicketAdd(props: {
  readonly stack: AgentPlanStack;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { stack } = props;
  if (!canEdit || stack.entries.length >= PLAN_STACK_ENTRY_COUNT) return null;
  return (
    <div className="relative flex h-8 items-center">
      <PlanTicketPicker
        taskId=""
        label={t("plans.stack.addTicket")}
        disabled={!canEdit}
        onSelect={(taskId) =>
          graph.edit((draft) =>
            addPlanStackTicket(draft, stack.id, {
              id: createRandomUuid(),
              taskId,
            }),
          )
        }
      />
    </div>
  );
}

/** Where the stack's trigger comes from, when a loop triggers it once per iteration. */
function StackScopeNote(props: {
  readonly view: PlanStackView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { draft, sources } = usePlanFlowContext();
  const loop = draft.nodes.find((node) => node.id === props.view.loopId);
  if (!loop) return null;
  return (
    <p
      data-plan-stack-scope={loop.id}
      className={cn(
        "truncate rounded-md border border-dashed border-plan-loop-edge/60 px-2 py-0.5 text-plan-loop",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {t("plans.stack.loopScope", { name: planNodeLabel(loop, sources) })}
    </p>
  );
}

/**
 * The Stack node: an ordered list of tickets or values, of which every
 * trigger hands over the next one.
 *
 * @remarks
 * IN sits on the left, the two data outputs Content and Count on the right
 * and the flow OUT on the header edge, like on every card. While a run is
 * shown, entries that were handed over are checked, and the marker says
 * whether the stack is empty or used up. Handing over is no proof of
 * success: a separate note names how the processing of the handed-over
 * entries stands; the card keeps its type colors.
 */
export function PlanStackCard(props: {
  readonly stack: AgentPlanStack;
  readonly hasRun: boolean;
  readonly isDropTarget: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const context = usePlanFlowContext();
  const { graph, onEdit } = context;
  const { stack } = props;
  const label = stack.name.trim() || t("plans.nodeType.stack");
  const view = planStackView(stack, {
    draft: context.draft,
    sources: context.sources,
    workspaces: context.workspaces ?? [],
    translate: t,
    run: context.run,
  });
  const outcome = planStackOutcome(context.draft, context.run, stack.id);
  const files = usePlanStackFileDrop(stack);
  function edit(): void {
    graph.select(stack.id);
    onEdit?.(stack.id);
  }
  return (
    <div
      {...files.handlers}
      data-plan-stack={stack.id}
      className={cn(
        "w-full min-w-0 rounded-xl",
        props.isDropTarget && "ring-2 ring-plan-stack/50 ring-offset-2",
      )}
    >
      <PlanCard
        node={stack}
        label={label}
        title={label}
        subtitle={t("plans.stack.caption")}
        status={<StackBadge view={view} hasRun={props.hasRun} />}
        flowDots={{ hasIn: false, hasOut: true }}
        onEdit={edit}
      >
        <div className={PLAN_CARD_BODY}>
          <PlanCardColumns
            inputs={<PlanStackFlowRow stack={stack} />}
            outputs={
              <>
                <PlanStackOutput
                  stack={stack}
                  output="content"
                  value={view.current?.label ?? t("plans.stack.noContent")}
                />
                <PlanStackOutput
                  stack={stack}
                  output="count"
                  value={t("plans.stack.countValue", { count: view.total })}
                />
              </>
            }
          />
          <StackScopeNote view={view} />
          <StackOutcomeNote outcome={outcome} />
          <PlanStackEntries view={view} />
          {files.row}
          <StackTicketAdd stack={stack} />
        </div>
        <StackSummary view={view} />
        {props.isDropTarget ? (
          <p
            role="status"
            className={cn(
              "px-3.5 pb-2 font-medium text-plan-stack",
              PLAN_NODE_TEXT.meta,
            )}
          >
            {t("plans.stack.dropHere")}
          </p>
        ) : null}
      </PlanCard>
    </div>
  );
}
