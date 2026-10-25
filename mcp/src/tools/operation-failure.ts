import { AGENT_LIMIT_CONSTRAINTS } from "../../../definition/PagesAgentOperations.js";

import { isRecord } from "../is-record.js";

import type {
  AgentPlanIssueEntry,
  AgentPlanIssueProblem,
} from "../../../definition/AgentPlanOperations.js";
import type {
  AgentLimitDetails,
  AgentOperationDetails,
  AgentPlanGraphRejection,
  AgentProjectCandidates,
  AgentRejectionReason,
} from "../../../definition/PagesAgentOperations.js";

/** Every reason of the contract, so a new one cannot be left out of the whitelist unnoticed. */
const REJECTION_REASONS: Readonly<
  Record<AgentRejectionReason["reason"], true>
> = {
  operation_retired: true,
  model_unavailable: true,
  reasoning_unsupported: true,
  reasoning_required: true,
  default_model_unavailable: true,
  sharing_target_unavailable: true,
  configuration_invalid: true,
  credentials_in_text: true,
  parameter_reference_unavailable: true,
  agent_limit_reached: true,
  agent_running: true,
  sharing_changes_required: true,
  text_changed: true,
  range_text_mismatch: true,
  range_reversed: true,
  line_out_of_range: true,
  column_out_of_range: true,
  graph_invalid: true,
  parameter_value_invalid: true,
  workspace_unavailable: true,
  element_missing: true,
  element_exists: true,
  plan_script_invalid: true,
  plan_script_profile_missing: true,
  plan_name_taken: true,
  plan_schema_unsupported: true,
  plan_running: true,
  plan_run_unavailable: true,
  plan_remote_unavailable: true,
  plan_context_changed: true,
  plan_workspace_conflict: true,
  plan_script_permission_denied: true,
  plan_script_interpreter_unavailable: true,
  plan_continuation_deleted: true,
  checklist_items_invalid: true,
  checklist_item_duplicate: true,
  checklist_item_unknown: true,
};

/** Every finding of the plan graph check, so a refused plan names what to fix. */
const ISSUE_PROBLEMS: Readonly<Record<AgentPlanIssueProblem, true>> = {
  remoteRunnerUpdate: true,
  remoteToolIncompatible: true,
  remotePagesUnavailable: true,
  remoteTicketUnavailable: true,
  remoteWikiUnavailable: true,
  remoteWorkspaceParameter: true,
  remoteAssetUnavailable: true,
  remoteAssetType: true,
  remoteAssetsTooLarge: true,
  remotePromptTooLarge: true,
  remoteParameter: true,
  remoteModel: true,
  remoteInterpreter: true,
  remoteContainer: true,
  remoteOffline: true,
  remoteIdentity: true,
  remoteCatalog: true,
  remoteWorkspace: true,
  remoteToolMissing: true,
  remoteLogin: true,
  remoteLoginUnknown: true,
  remoteOptions: true,
  groupSize: true,
  groupProvider: true,
  groupConfiguration: true,
  groupOrder: true,
  groupBoundary: true,
  groupBinding: true,
  loopSize: true,
  loopBoundary: true,
  loopRuns: true,
  loopCondition: true,
  loopPrevious: true,
  loopProvider: true,
  unsupportedRunNotes: true,
  duplicateNode: true,
  port: true,
  duplicate: true,
  cycle: true,
  type: true,
  ticketHandoff: true,
  resultSource: true,
  resultOrder: true,
  resultMissing: true,
  resultAmbiguous: true,
  source: true,
  required: true,
  start: true,
  end: true,
  flowIn: true,
  flowOut: true,
  unreachable: true,
  agent: true,
  name: true,
  json: true,
  number: true,
  scriptUnavailable: true,
  scriptConfiguration: true,
  loopScriptUnsupported: true,
};

/** Findings a refusal carries at most. */
const MAXIMUM_ISSUES = 50;

function isRejectionReason(
  input: unknown,
): input is AgentRejectionReason["reason"] {
  return typeof input === "string" && Object.hasOwn(REJECTION_REASONS, input);
}

/** Whitelisted business errors; provider diagnostics and submitted credentials are discarded. */
export class PagesOperationError extends Error {
  public readonly code:
    | "NOT_FOUND"
    | "AMBIGUOUS"
    | "INVALID_REQUEST"
    | "PAYLOAD_TOO_LARGE"
    | "CONFLICT"
    | "FORBIDDEN"
    | "CONFIRMATION_REQUIRED";
  public readonly details: AgentOperationDetails | undefined;

  public constructor(
    code: PagesOperationError["code"],
    details?: AgentOperationDetails,
  ) {
    super(
      code === "NOT_FOUND"
        ? "Not found or no access."
        : "The agent API request was rejected.",
    );
    this.code = code;
    this.details = details;
  }
}

function readLimit(input: unknown): AgentLimitDetails | undefined {
  if (!isRecord(input)) return undefined;
  const fields = input;
  const constraint = AGENT_LIMIT_CONSTRAINTS.find(
    (name) => name === fields.constraint,
  );
  if (
    !constraint ||
    typeof fields.limit !== "number" ||
    !Number.isSafeInteger(fields.limit) ||
    fields.limit <= 0
  )
    return undefined;
  return { constraint, limit: fields.limit };
}

function readCandidates(input: unknown): AgentProjectCandidates | undefined {
  if (!isRecord(input)) return undefined;
  const details = input;
  if (
    !Array.isArray(details.candidates) ||
    details.candidates.length > 100 ||
    typeof details.truncated !== "boolean"
  )
    return undefined;
  const candidates: { id: string; name: string }[] = [];
  for (const entry of details.candidates) {
    if (!isRecord(entry)) return undefined;
    const candidate = entry;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string")
      return undefined;
    candidates.push({ id: candidate.id, name: candidate.name });
  }
  return { candidates, truncated: details.truncated };
}

function readRevision(
  input: unknown,
): { readonly currentRevision: number } | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    !("currentRevision" in input) ||
    typeof input.currentRevision !== "number" ||
    !Number.isSafeInteger(input.currentRevision) ||
    input.currentRevision < 1
  )
    return undefined;
  return { currentRevision: input.currentRevision };
}

/** Parses only public business codes and visible choices; authentication failures stay generic. */
export async function operationFailure(
  response: Response,
): Promise<PagesOperationError | undefined> {
  let input: unknown;
  try {
    input = await response.json();
  } catch {
    return undefined;
  }
  if (!isRecord(input)) return undefined;
  const envelope = input;
  if (envelope.apiVersion !== "1" || !isRecord(envelope.error))
    return undefined;
  const error = envelope.error;
  if (error.code === "AMBIGUOUS" && response.status === 409) {
    const details = readCandidates(error.details);
    return details ? new PagesOperationError("AMBIGUOUS", details) : undefined;
  }
  const publicCode = (
    [
      "NOT_FOUND",
      "INVALID_REQUEST",
      "PAYLOAD_TOO_LARGE",
      "CONFLICT",
      "FORBIDDEN",
      "CONFIRMATION_REQUIRED",
    ] as const
  ).find((code) => code === error.code);
  if (publicCode) {
    const expectedStatus = {
      NOT_FOUND: 404,
      INVALID_REQUEST: 400,
      PAYLOAD_TOO_LARGE: 413,
      CONFLICT: 409,
      FORBIDDEN: 403,
      CONFIRMATION_REQUIRED: 400,
    }[publicCode];
    const details = failureDetails(publicCode, error.details);
    return response.status === expectedStatus
      ? new PagesOperationError(publicCode, details)
      : undefined;
  }
  return undefined;
}

function isIssueProblem(input: unknown): input is AgentPlanIssueProblem {
  return typeof input === "string" && Object.hasOwn(ISSUE_PROBLEMS, input);
}

function readIssueText(input: unknown): string | null | undefined {
  return input === null || typeof input === "string" ? input : undefined;
}

function readIssue(input: unknown): AgentPlanIssueEntry | undefined {
  if (!isRecord(input)) return undefined;
  const issue = input;
  const nodeId = readIssueText(issue.nodeId);
  const port = readIssueText(issue.port);
  if (nodeId === undefined || port === undefined) return undefined;
  return isIssueProblem(issue.problem)
    ? { nodeId, port, problem: issue.problem }
    : undefined;
}

/** The findings of a refused plan graph, or `undefined` when any of them is malformed. */
function readIssues(input: unknown): AgentPlanIssueEntry[] | undefined {
  if (!Array.isArray(input) || input.length > MAXIMUM_ISSUES) return undefined;
  const issues: AgentPlanIssueEntry[] = [];
  for (const entry of input) {
    const issue = readIssue(entry);
    if (!issue) return undefined;
    issues.push(issue);
  }
  return issues;
}

function readReason(
  input: unknown,
): AgentRejectionReason | AgentPlanGraphRejection | undefined {
  if (typeof input !== "object" || input === null || !("reason" in input))
    return undefined;
  if (!isRejectionReason(input.reason)) return undefined;
  if (input.reason !== "graph_invalid" || !("issues" in input))
    return { reason: input.reason };
  const issues = readIssues(input.issues);
  return issues === undefined
    ? { reason: input.reason }
    : { reason: input.reason, issues };
}

function failureDetails(
  code: PagesOperationError["code"],
  details: unknown,
): AgentOperationDetails | undefined {
  if (code === "PAYLOAD_TOO_LARGE") return readLimit(details);
  if (code === "CONFLICT") return readRevision(details) ?? readReason(details);
  if (code === "INVALID_REQUEST" || code === "FORBIDDEN")
    return readReason(details);
  return undefined;
}
