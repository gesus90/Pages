import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

/** The codes of a finding in a plan notation (PAGE-250, section 3). */
export type PlanNotationIssueCode =
  | "syntax"
  | "unsupported_element"
  | "unknown_attribute"
  | "invalid_value"
  | "duplicate_field"
  | "duplicate_node"
  | "unknown_node"
  | "unknown_port"
  | "name_not_found"
  | "name_ambiguous"
  | "plan_invalid";

/** A place in the notation; lines and columns count from 1. */
export interface PlanNotationLocation {
  readonly line: number;
  readonly column: number;
}

/** One object a name could mean: its identifier and its name. */
export interface PlanNotationCandidate {
  readonly id: string;
  readonly name: string;
}

/**
 * One finding of a check.
 *
 * @remarks
 * `candidates` lists what a name could have meant: every match of an
 * ambiguous name, or the available names of one that was not found.
 */
export interface PlanNotationIssue extends PlanNotationLocation {
  readonly nodeId: string | null;
  readonly code: PlanNotationIssueCode;
  readonly candidates?: readonly PlanNotationCandidate[];
}

/** The most candidates a finding lists, so a large catalog does not flood the answer. */
const CANDIDATE_LIMIT = 50;

/**
 * Creates a finding at a place of the notation.
 *
 * @param location - Where the finding is.
 * @param code - What is wrong.
 * @param nodeId - The node it belongs to, or `null` for the plan.
 * @param candidates - What a name could have meant, for the two name codes.
 */
export function planNotationIssue(
  location: PlanNotationLocation,
  code: PlanNotationIssueCode,
  nodeId: string | null = null,
  candidates?: readonly PlanNotationCandidate[],
): PlanNotationIssue {
  return {
    line: location.line,
    column: location.column,
    nodeId,
    code,
    ...(candidates === undefined
      ? {}
      : { candidates: candidates.slice(0, CANDIDATE_LIMIT) }),
  };
}

/**
 * Tells whether an error is a refusal of the plan readers.
 *
 * @param error - What a reader of `backend/agents/AgentPlanInput.ts` threw.
 * @returns `true` for the refusals of its readers: an agent error, an invalid
 * request of the completion gate, a schema failure of a nested reader.
 *
 * @remarks
 * A refusal becomes a finding of the notation; anything else is a fault and
 * keeps its way to the failure answer.
 */
export function isPlanReaderRefusal(error: unknown): boolean {
  return (
    error instanceof AgentError ||
    error instanceof z.ZodError ||
    (error instanceof AgentOperationError && error.code === "INVALID_REQUEST")
  );
}

/** A notation that cannot become a plan, with every finding of it. */
export class PlanNotationError extends Error {
  public readonly issues: readonly PlanNotationIssue[];

  /**
   * Creates the error.
   *
   * @param issues - The findings, at least one.
   */
  public constructor(issues: readonly PlanNotationIssue[]) {
    super("The plan notation is invalid.");
    this.name = "PlanNotationError";
    this.issues = issues;
  }
}
