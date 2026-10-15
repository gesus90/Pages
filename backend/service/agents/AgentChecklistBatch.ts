import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { setDescriptionCheckbox } from "@/backend/service/task/TicketChecklist";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { readAgentTicketReference } from "./AgentTicketValidation";

import type { MaterializedChecklist } from "@/backend/service/task/TicketChecklist";
import type { AgentChecklistItemState } from "@/definition/AgentTicketChecklist";
import type { AgentTicketReference } from "@/definition/AgentTickets";

// Keeps the request inside the 64 KiB limit even with the longer criterion identifiers.
const MAXIMUM_BATCH_ENTRIES = 500;

/** One validated bulk change; the operation ID binds to exactly these values. */
export interface ChecklistBatch {
  readonly operationId: string;
  readonly ticket: AgentTicketReference;
  readonly expectedRevision: string;
  readonly items: readonly AgentChecklistItemState[];
}

/** What a bulk change has to store, resolved against the checklist it was read from. */
export interface ChecklistWrites {
  /** Acceptance criteria whose done state differs from the request. */
  readonly criteria: readonly {
    readonly id: string;
    readonly isDone: boolean;
  }[];
  /** Checkbox characters of the description that differ from the request. */
  readonly markers: readonly {
    readonly offset: number;
    readonly checked: boolean;
  }[];
}

function invalid(
  reason:
    | "checklist_items_invalid"
    | "checklist_item_duplicate"
    | "checklist_item_unknown",
): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST", { reason });
}

function readItemState(input: unknown): AgentChecklistItemState {
  try {
    const fields = readParameterRecord(input);
    requireParameterKeys(fields, ["itemId", "checked"]);
    if (typeof fields.checked !== "boolean")
      throw new AgentOperationError("INVALID_REQUEST");
    return { itemId: readIdentifier(fields.itemId), checked: fields.checked };
  } catch (error: unknown) {
    // The shared readers only say "invalid"; here the entry list is what to fix.
    if (error instanceof AgentOperationError)
      throw invalid("checklist_items_invalid");
    throw error;
  }
}

function readItemStates(input: unknown): readonly AgentChecklistItemState[] {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > MAXIMUM_BATCH_ENTRIES
  )
    throw invalid("checklist_items_invalid");
  const states = input.map((entry: unknown) => readItemState(entry));
  const identifiers = new Set(states.map((state) => state.itemId));
  if (identifiers.size !== states.length)
    throw invalid("checklist_item_duplicate");
  return states;
}

/**
 * Validates the parameters of a bulk change before anything is looked up.
 *
 * @param input - The raw operation parameters.
 * @returns The change, with every entry named once and an explicit state.
 * @throws {AgentOperationError} `INVALID_REQUEST`, with a reason for a bad entry list.
 */
export function readChecklistBatch(input: unknown): ChecklistBatch {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, [
    "operationId",
    "ticketId",
    "expectedRevision",
    "items",
  ]);
  return {
    operationId: readIdentifier(fields.operationId),
    ticket: readAgentTicketReference(fields.ticketId),
    expectedRevision: readIdentifier(fields.expectedRevision),
    items: readItemStates(fields.items),
  };
}

/**
 * Resolves every named entry against the checklist and keeps what has to change.
 *
 * @param checklist - The checklist the revision check passed for.
 * @param items - The validated entries of the request.
 * @returns The criteria and checkbox characters to store; entries that already have the state are left out.
 * @throws {AgentOperationError} `INVALID_REQUEST` with `checklist_item_unknown` before anything is written.
 */
export function planChecklistWrites(
  checklist: MaterializedChecklist,
  items: readonly AgentChecklistItemState[],
): ChecklistWrites {
  const criteria: { id: string; isDone: boolean }[] = [];
  const markers: { offset: number; checked: boolean }[] = [];
  for (const state of items) {
    const entry = checklist.items.find((item) => item.id === state.itemId);
    if (!entry) throw invalid("checklist_item_unknown");
    if (entry.checked === state.checked) continue;
    const criterion = checklist.criteria.get(entry.id);
    const offset = checklist.markers.get(entry.id);
    if (criterion) criteria.push({ id: criterion.id, isDone: state.checked });
    else if (offset !== undefined)
      markers.push({ offset, checked: state.checked });
    else throw invalid("checklist_item_unknown");
  }
  return { criteria, markers };
}

/**
 * Sets the planned checkboxes of a description and leaves every other character as it is.
 *
 * @param markdown - The stored description.
 * @param markers - The checkbox characters to set.
 * @returns The description with exactly those characters replaced.
 */
export function applyChecklistMarkers(
  markdown: string,
  markers: ChecklistWrites["markers"],
): string {
  // Each replacement swaps one character for one, so the offsets stay valid in any order.
  return markers.reduce(
    (text, marker) =>
      setDescriptionCheckbox(text, marker.offset, marker.checked),
    markdown,
  );
}
