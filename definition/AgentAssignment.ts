import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";

/** Defined functions can be assigned; SKILLS has no execution contract yet. */
export const AGENT_FUNCTIONS = ["skills"] as const;
export type AgentFunction = (typeof AGENT_FUNCTIONS)[number];

/** An instance assignment references one connection's own catalog. */
export interface AgentAssignment {
  readonly function: AgentFunction;
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** Narrows external input without granting authority to define new functions. */
export function isAgentFunction(value: unknown): value is AgentFunction {
  return value === "skills";
}

/** Unusable saved assignments remain visible with a safe translated reason. */
export interface AgentAssignmentView extends AgentAssignment {
  readonly error: AgentExecutionErrorCode | null;
}
