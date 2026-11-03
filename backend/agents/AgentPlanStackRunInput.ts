import { AgentError } from "@/backend/error/AgentErrors";
import { PLAN_STACK_ENTRY_COUNT } from "@/definition/AgentPlanStack";

import { readPlanText } from "./AgentPlanInput";
import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanStackDelivery,
  AgentPlanStackHandover,
  AgentPlanStackRun,
} from "@/definition/AgentPlanStack";

function isCount(input: unknown): input is number {
  return (
    typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input >= 0 &&
    input <= PLAN_STACK_ENTRY_COUNT
  );
}

/** Narrows what one start of a stack node handed over, as a run stores it. */
export function readPlanStackHandover(input: unknown): AgentPlanStackHandover {
  const handover = readAgentObject(input);
  const { entryId, position, total } = handover;
  if (!isCount(position) || !isCount(total) || position > total)
    throw new AgentError("plan_invalid");
  if (entryId === null) {
    if (position !== 0) throw new AgentError("plan_invalid");
    return { entryId: null, position, total };
  }
  if (position < 1) throw new AgentError("plan_invalid");
  return { entryId: readPlanText(entryId), position, total };
}

function readDelivery(input: unknown): AgentPlanStackDelivery {
  const delivery = readAgentObject(input);
  const { position, iteration } = delivery;
  if (
    !isCount(position) ||
    position < 1 ||
    (iteration !== null &&
      (typeof iteration !== "number" ||
        !Number.isSafeInteger(iteration) ||
        iteration < 1))
  )
    throw new AgentError("plan_invalid");
  return {
    entryId: readPlanText(delivery.entryId),
    position,
    loopId: delivery.loopId === null ? null : readPlanText(delivery.loopId),
    iteration,
    at: readPlanText(delivery.at),
  };
}

function readStackRun(input: unknown): AgentPlanStackRun {
  const record = readAgentObject(input);
  const { total, emptyTriggers, last, deliveries } = record;
  if (
    !isCount(total) ||
    typeof emptyTriggers !== "number" ||
    !Number.isSafeInteger(emptyTriggers) ||
    emptyTriggers < 0 ||
    (last !== null && last !== "entry" && last !== "empty") ||
    !Array.isArray(deliveries) ||
    deliveries.length > total
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(record.id),
    name: readPlanText(record.name, 120),
    total,
    deliveries: deliveries.map(readDelivery),
    emptyTriggers,
    last,
  };
}

/** Narrows the persisted state of the stacks of a run. */
export function readPlanStackRuns(
  input: unknown,
): readonly AgentPlanStackRun[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new AgentError("plan_invalid");
  return input.map(readStackRun);
}
