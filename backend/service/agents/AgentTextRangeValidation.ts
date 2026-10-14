import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_TEXT_RANGE_LIMITS } from "@/definition/AgentTextRange";

import {
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type {
  AgentTextPatch,
  AgentTextPosition,
  AgentTextRangeRequest,
} from "@/definition/AgentTextRange";

/** The parameter names every range patch carries besides its target and version. */
export const TEXT_PATCH_KEYS = [
  "start",
  "end",
  "expectedText",
  "replacementText",
] as const;

/** The parameter names of a passage read besides its target. */
export const TEXT_RANGE_READ_KEYS = ["start", "end", "maxCharacters"] as const;

function readCounter(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1)
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/** A position of a read names the line; its column may be left out, which is column 1. */
function readOpenPosition(input: unknown): AgentTextPosition {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["line"], ["column"]);
  return {
    line: readCounter(fields.line),
    column: fields.column === undefined ? 1 : readCounter(fields.column),
  };
}

/** A position of a patch names line and column. */
function readFullPosition(input: unknown): AgentTextPosition {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["line", "column"]);
  return { line: readCounter(fields.line), column: readCounter(fields.column) };
}

function readText(input: unknown): string {
  if (typeof input !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function readBudget(input: unknown): number {
  if (input === undefined) return AGENT_TEXT_RANGE_LIMITS.defaultCharacters;
  const budget = readCounter(input);
  if (budget > AGENT_TEXT_RANGE_LIMITS.maximumCharacters)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "textRangeCharacters",
      limit: AGENT_TEXT_RANGE_LIMITS.maximumCharacters,
    });
  return budget;
}

/**
 * Reads the range of a passage read.
 *
 * @param fields - The operation parameters, target already read.
 * @returns The start, the optional end and the character budget.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a malformed position, `PAYLOAD_TOO_LARGE` for a budget over the limit.
 *
 * @remarks
 * Only `start` is required and its column may be left out. Without `end` the
 * read runs on from `start` for at most `maxCharacters`.
 */
export function readAgentTextRangeRequest(
  fields: Readonly<Record<string, unknown>>,
): AgentTextRangeRequest {
  return {
    start: readOpenPosition(fields.start),
    end: fields.end === undefined ? null : readOpenPosition(fields.end),
    maxCharacters: readBudget(fields.maxCharacters),
  };
}

/**
 * Reads the range, the expected text and the replacement of a patch.
 *
 * @param fields - The operation parameters, target and version already read.
 * @returns The patch; the complete text is never part of it.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing or malformed value.
 *
 * @remarks
 * Both positions are required with line and column, so a patch never
 * resolves a default onto some other range.
 */
export function readAgentTextPatch(
  fields: Readonly<Record<string, unknown>>,
): AgentTextPatch {
  const { includeAfter } = fields;
  if (includeAfter !== undefined && typeof includeAfter !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    start: readFullPosition(fields.start),
    end: readFullPosition(fields.end),
    expectedText: readText(fields.expectedText),
    replacementText: readText(fields.replacementText),
    includeAfter: includeAfter === true,
  };
}
