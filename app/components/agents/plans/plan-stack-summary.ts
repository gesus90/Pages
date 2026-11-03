import { planStackScope, planStackState } from "@/definition/AgentPlanStack";

import { planNodeLabel } from "./plan-layout";
import { planValuePreview } from "./plan-node-card/plan-value-preview";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type {
  AgentPlanStack,
  AgentPlanStackDelivery,
  AgentPlanStackEntry,
  AgentPlanStackRun,
} from "@/definition/AgentPlanStack";
import type { PlanValueContext } from "./plan-node-card/plan-value-preview";

/** How an entry of a stack stands in the shown run. */
export type PlanStackEntryState = "delivered" | "next" | "waiting";

/** One entry as the card lists it. */
export interface PlanStackEntryView {
  readonly entry: AgentPlanStackEntry;
  /** Counts from 1. */
  readonly position: number;
  readonly label: string;
  readonly state: PlanStackEntryState;
  /** The handover of a delivered entry, with its loop iteration. */
  readonly delivery: AgentPlanStackDelivery | null;
}

/** What the card of a stack shows about the shown run. */
export interface PlanStackView {
  readonly entries: readonly PlanStackEntryView[];
  readonly total: number;
  readonly delivered: number;
  readonly remaining: number;
  /** `empty` without entries, `used` once every entry was handed over. */
  readonly state: "ready" | "used" | "empty";
  /** The entry the content output holds now, or `null`. */
  readonly current: PlanStackEntryView | null;
  /** The loop whose iterations trigger the stack, or `null` in the outer graph. */
  readonly loopId: string | null;
}

/** The recorded state of a stack in the shown run. */
export function planStackRunOf(
  run: AgentPlanRun | null,
  stackId: string,
): AgentPlanStackRun | undefined {
  return run?.stacks?.find((entry) => entry.id === stackId);
}

/** The name of an entry: the ticket's key and title, or the value's name and value. */
export function planStackEntryLabel(
  entry: AgentPlanStackEntry,
  context: PlanValueContext,
): string {
  if (entry.type === "task")
    return planNodeLabel(
      { id: entry.id, type: "task", taskId: entry.taskId, x: 0, y: 0 },
      context.sources,
    );
  return `${entry.name} = ${planValuePreview(entry.value, context)}`;
}

/**
 * Describes a stack for its card: its ordered entries and how far the shown run got.
 *
 * @param stack - The stack of the draft.
 * @param context - The draft, its sources, the shown run and the translation.
 */
export function planStackView(
  stack: AgentPlanStack,
  context: PlanValueContext & {
    readonly draft: AgentPlanInput;
    readonly run: AgentPlanRun | null;
  },
): PlanStackView {
  const record = planStackRunOf(context.run, stack.id);
  const deliveries = record?.deliveries ?? [];
  const entries = stack.entries.map((entry, index): PlanStackEntryView => {
    const delivery =
      deliveries.find((candidate) => candidate.entryId === entry.id) ?? null;
    return {
      entry,
      position: index + 1,
      label: planStackEntryLabel(entry, context),
      delivery,
      state: entryState(delivery, index, deliveries.length),
    };
  });
  const scope = planStackScope(context.draft, stack.id);
  const currentId =
    record?.last === "entry" ? deliveries.at(-1)?.entryId : null;
  return {
    entries,
    total: stack.entries.length,
    delivered: Math.min(deliveries.length, stack.entries.length),
    remaining: Math.max(0, stack.entries.length - deliveries.length),
    state: planStackState(stack, record),
    current: entries.find((view) => view.entry.id === currentId) ?? null,
    loopId: scope.kind === "loop" ? scope.loopId : null,
  };
}

function entryState(
  delivery: AgentPlanStackDelivery | null,
  index: number,
  delivered: number,
): PlanStackEntryState {
  if (delivery) return "delivered";
  return index === delivered ? "next" : "waiting";
}

/** The sources a stack card names its entries with. */
export type PlanStackSources = Pick<AgentPlanSources, "tasks">;
