import {
  PICA_MOBILE_MAXIMUM_PLAN_ROWS,
  PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH,
} from "@/definition/PicaMobileProtocol";

import { toPicaMobileRunStatus } from "../PicaMobileRunMapping";

import type {
  AgentPlanOverviewEntry,
  AgentPlanOverviewRun,
} from "@/backend/service/agents/AgentPlanOverview";
import type {
  PicaMobilePlanRow,
  PicaMobilePlanRowChange,
  PicaMobilePlanRowField,
} from "@/definition/PicaMobileProtocol";

/** What changed between the rows a connection holds and the rows it gets next. */
export interface PicaMobilePlanRowsChange {
  /** New rows in full and changed rows with their changed fields. */
  readonly plans: readonly PicaMobilePlanRowChange[];
  /** Plans that left the list. */
  readonly removed: readonly string[];
}

const STEP_SEPARATOR = ", ";

/** Every field besides `id`, in the order a row lists them. */
const ROW_FIELDS: readonly PicaMobilePlanRowField[] = [
  "name",
  "status",
  "runId",
  "step",
  "done",
  "total",
  "error",
  "at",
];

/**
 * Cuts a text to the longest length a row field may have.
 *
 * @param text - The text.
 * @returns At most {@link PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH} code units,
 * never ending in half a surrogate pair.
 */
export function truncatePlanText(text: string): string {
  if (text.length <= PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH) {
    return text;
  }

  const cut = text.slice(0, PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);

  // A high surrogate at the end would leave a broken character.
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function toIsoTime(text: string): string | undefined {
  const time = Date.parse(text);

  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function runFields(
  run: AgentPlanOverviewRun,
): Omit<PicaMobilePlanRow, "id" | "name"> {
  const at = toIsoTime(run.at);

  return {
    status: toPicaMobileRunStatus(run.status),
    runId: run.id,
    ...(run.runningSteps.length === 0
      ? {}
      : { step: truncatePlanText(run.runningSteps.join(STEP_SEPARATOR)) }),
    done: run.completedSteps,
    total: run.totalSteps,
    ...(run.failure === null
      ? {}
      : {
          error: {
            code: run.failure.code,
            step:
              run.failure.stepName === null
                ? null
                : truncatePlanText(run.failure.stepName),
          },
        }),
    ...(at === undefined ? {} : { at }),
  };
}

/**
 * Maps a plan of the overview onto a row of `plans`.
 *
 * @param entry - The plan with its latest own run.
 * @returns The row, or `null` for a plan identifier longer than the
 * protocol allows.
 */
export function toPlanRow(
  entry: AgentPlanOverviewEntry,
): PicaMobilePlanRow | null {
  if (entry.planId.length > PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH) {
    return null;
  }

  const name = truncatePlanText(entry.name);

  return entry.run === null
    ? { id: entry.planId, name, status: "idle" }
    : { id: entry.planId, name, ...runFields(entry.run) };
}

function rank(row: PicaMobilePlanRow): number {
  if (
    row.status === "running" ||
    row.status === "pausing" ||
    row.status === "stopping"
  ) {
    return row.error === undefined ? 2 : 1;
  }

  if (row.status === "paused") return 3;

  return row.status === "failed" ? 4 : 5;
}

function compareText(first: string, second: string): number {
  if (first === second) return 0;

  return first < second ? -1 : 1;
}

function compareRows(
  first: PicaMobilePlanRow,
  second: PicaMobilePlanRow,
): number {
  const byRank = rank(first) - rank(second);

  if (byRank !== 0) return byRank;

  if (first.at !== second.at) {
    // Rows without a time come last; the others newest first.
    if (first.at === undefined) return 1;
    if (second.at === undefined) return -1;

    return compareText(second.at, first.at);
  }

  return (
    compareText(first.name, second.name) || compareText(first.id, second.id)
  );
}

/**
 * Picks the rows a connection holds, in the order of the contract.
 *
 * @param rows - Every row of the overview.
 * @returns At most {@link PICA_MOBILE_MAXIMUM_PLAN_ROWS} rows: running ones
 * with a failure, running ones, paused, failed, then all others; within each
 * class the newest first, then by name.
 */
export function selectPlanRows(
  rows: readonly PicaMobilePlanRow[],
): PicaMobilePlanRow[] {
  return [...rows].sort(compareRows).slice(0, PICA_MOBILE_MAXIMUM_PLAN_ROWS);
}

function isSameValue(first: unknown, second: unknown): boolean {
  // Field values are texts, numbers or the small error object built in one order.
  return JSON.stringify(first) === JSON.stringify(second);
}

/** The new value of a field; `undefined` while it is unchanged, `null` once it has none. */
function changedValue<Value>(
  before: Value | undefined,
  after: Value | undefined,
): Value | null | undefined {
  if (isSameValue(before, after)) {
    return undefined;
  }

  return after ?? null;
}

function diffRow(
  previous: PicaMobilePlanRow,
  next: PicaMobilePlanRow,
): PicaMobilePlanRowChange | null {
  // An unchanged field stays undefined, which the JSON text leaves out.
  const change: PicaMobilePlanRowChange = {
    id: next.id,
    name: changedValue(previous.name, next.name),
    status: changedValue(previous.status, next.status),
    runId: changedValue(previous.runId, next.runId),
    step: changedValue(previous.step, next.step),
    done: changedValue(previous.done, next.done),
    total: changedValue(previous.total, next.total),
    error: changedValue(previous.error, next.error),
    at: changedValue(previous.at, next.at),
  };

  return ROW_FIELDS.some((field) => change[field] !== undefined)
    ? change
    : null;
}

/**
 * Finds what changed between two lists of rows.
 *
 * @param previous - The rows the connection holds, by plan.
 * @param next - The rows it gets next.
 * @returns New rows in full, changed rows with only their changed fields
 * (`null` for a field without a value now) and the plans that left.
 */
export function diffPlanRows(
  previous: ReadonlyMap<string, PicaMobilePlanRow>,
  next: readonly PicaMobilePlanRow[],
): PicaMobilePlanRowsChange {
  const present = new Set(next.map((row) => row.id));
  const plans = next.flatMap((row) => {
    const before = previous.get(row.id);

    if (before === undefined) return [row];

    const change = diffRow(before, row);

    return change === null ? [] : [change];
  });

  return {
    plans,
    removed: [...previous.keys()].filter((id) => !present.has(id)),
  };
}
