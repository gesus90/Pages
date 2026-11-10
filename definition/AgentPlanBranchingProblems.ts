/**
 * The findings the checks of decisions, boolean results and events can report.
 *
 * @remarks
 * A file of its own without imports, because the MCP package reads it through
 * the operation contract.
 */
export const PLAN_BRANCHING_PROBLEMS = [
  "decisionCondition",
  "decisionBranch",
  "decisionInput",
  "decisionSequence",
  "decisionModel",
  "decisionQuestion",
  "decisionCases",
  "eventOrder",
  "eventFanout",
  "eventNesting",
  "branchBoundary",
  "branchProvider",
  "branchRemote",
  "branchGate",
] as const;
