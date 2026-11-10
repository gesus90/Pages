import { AGENT_LIMIT_CONSTRAINTS } from "@/definition/PagesAgentOperations";
import { readPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

import type { AgentOperationError } from "@/backend/error/AgentOperationError";
import type {
  AgentPlanIssueEntry,
  AgentPlanIssueProblem,
} from "@/definition/AgentPlanOperations";
import type {
  AgentLimitDetails,
  AgentOperationDetails,
  AgentPlanCleanupRejection,
  AgentPlanGraphRejection,
  AgentProjectCandidates,
  AgentRejectionReason,
  AgentStepReportRejection,
  StepReportRejectionReason,
} from "@/definition/PagesAgentOperations";

/** Narrows external JSON objects before their fields are inspected. */
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/** Every reason of the contract, so a new one cannot be left out of the whitelist unnoticed. */
const REJECTION_REASONS: Readonly<
  Record<AgentRejectionReason["reason"], true>
> = {
  ticket_attachment_upload_required: true,
  ticket_attachment_upload_unavailable: true,
  ticket_attachment_unavailable: true,
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
  plan_frame_repair_required: true,
  parameter_value_invalid: true,
  workspace_unavailable: true,
  element_missing: true,
  element_exists: true,
  plan_script_invalid: true,
  plan_script_profile_missing: true,
  plan_name_taken: true,
  template_name_taken: true,
  plan_schema_unsupported: true,
  plan_running: true,
  plan_run_unavailable: true,
  plan_run_unreadable: true,
  plan_payload_missing: true,
  plan_payload_corrupt: true,
  plan_history_unavailable: true,
  plan_start_rejection_record_failed: true,
  plan_remote_unavailable: true,
  plan_runner_payload_update_required: true,
  plan_context_changed: true,
  plan_workspace_conflict: true,
  plan_recovery_cleanup_unconfirmed: true,
  plan_recovery_diagnostic_unavailable: true,
  plan_recovery_action_unavailable: true,
  plan_recovery_revision_conflict: true,
  plan_recovery_idempotency_conflict: true,
  plan_recovery_review_required: true,
  plan_recovery_native_resume_unavailable: true,
  plan_recovery_checkpoint_invalid: true,
  plan_recovery_checkpoint_too_large: true,
  plan_recovery_workflow_unavailable: true,
  plan_script_permission_denied: true,
  plan_script_interpreter_unavailable: true,
  plan_continuation_deleted: true,
  checklist_items_invalid: true,
  checklist_item_duplicate: true,
  checklist_item_unknown: true,
  step_report_invalid: true,
  step_report_foreign: true,
  step_report_closed: true,
};

/** The reasons whose problems tell an agent what to correct in its step report. */
const STEP_REPORT_REASONS: Readonly<Record<StepReportRejectionReason, true>> = {
  step_report_invalid: true,
  step_report_foreign: true,
  step_report_closed: true,
};

/** Every finding of the plan graph check, so a refused plan names what to fix. */
const ISSUE_PROBLEMS: Readonly<Record<AgentPlanIssueProblem, true>> = {
  remoteRunnerUpdate: true,
  remoteToolIncompatible: true,
  remotePagesUnavailable: true,
  remoteTicketUnavailable: true,
  remoteWikiUnavailable: true,
  remoteWorkspaceParameter: true,
  remoteAssetRunner: true,
  remoteAssetUnavailable: true,
  remoteAssetType: true,
  remoteAssetsTooLarge: true,
  remotePromptTooLarge: true,
  remoteParameter: true,
  remoteModel: true,
  remoteInterpreter: true,
  remoteInterpreterRemoved: true,
  remoteCatalogStale: true,
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
  decisionCondition: true,
  decisionBranch: true,
  decisionInput: true,
  decisionSequence: true,
  decisionModel: true,
  decisionQuestion: true,
  decisionCases: true,
  eventOrder: true,
  eventFanout: true,
  eventNesting: true,
  branchBoundary: true,
  branchProvider: true,
  branchRemote: true,
  branchGate: true,
  stackScope: true,
  stackOrder: true,
  stackEntries: true,
  stackRemote: true,
  assetFile: true,
  assetUnreadable: true,
  loopWhile: true,
  loopNested: true,
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
  boolean: true,
  scriptUnavailable: true,
  scriptConfiguration: true,
  scriptReportTarget: true,
  scriptReportGate: true,
  loopScriptUnsupported: true,
  gitCloseoutConfiguration: true,
  gitCloseoutRemote: true,
};

/** Findings a refusal carries at most. */
const MAXIMUM_ISSUES = 50;
/** The length of one step report problem, as Pages bounds it. */
const MAXIMUM_PROBLEM_TEXT = 500;

function isRejectionReason(
  input: unknown,
): input is AgentRejectionReason["reason"] {
  return typeof input === "string" && Object.hasOwn(REJECTION_REASONS, input);
}

/** Whitelisted business errors; provider diagnostics and submitted credentials are discarded. */
export class PlanOperationFailure extends Error {
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
    code: PlanOperationFailure["code"],
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

/**
 * Reduces a business error to its public code and visible choices.
 *
 * @param error - The error the Pages operation raised.
 * @returns The whitelisted failure, or `undefined` for a malformed rejection; authentication failures never get here.
 */
export function planOperationFailure(
  error: AgentOperationError,
): PlanOperationFailure | undefined {
  if (error.code === "AMBIGUOUS") {
    const candidates = readCandidates(error.details);
    return candidates
      ? new PlanOperationFailure("AMBIGUOUS", candidates)
      : undefined;
  }
  return new PlanOperationFailure(
    error.code,
    failureDetails(error.code, error.details),
  );
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
    ? { nodeId, port, problem: issue.problem, ...readAssetIssue(issue.asset) }
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

function isStepReportReason(
  input: unknown,
): input is StepReportRejectionReason {
  return typeof input === "string" && Object.hasOwn(STEP_REPORT_REASONS, input);
}

/** The problems of a refused step report, or `undefined` when any of them is malformed. */
function readProblems(input: unknown): readonly string[] | undefined {
  if (!Array.isArray(input) || input.length > MAXIMUM_ISSUES) return undefined;
  const problems: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string" || entry.length > MAXIMUM_PROBLEM_TEXT)
      return undefined;
    problems.push(entry);
  }
  return problems;
}

function readStepReportRejection(
  input: object,
): AgentStepReportRejection | undefined {
  if (!("reason" in input) || !isStepReportReason(input.reason))
    return undefined;
  const problems =
    "problems" in input ? readProblems(input.problems) : undefined;
  return problems && { reason: input.reason, problems };
}

function readReason(
  input: unknown,
):
  | AgentRejectionReason
  | AgentStepReportRejection
  | AgentPlanGraphRejection
  | AgentPlanCleanupRejection
  | undefined {
  if (typeof input !== "object" || input === null || !("reason" in input))
    return undefined;
  if (!isRejectionReason(input.reason)) return undefined;
  if (
    input.reason === "plan_recovery_cleanup_unconfirmed" &&
    "cleanupFailure" in input
  ) {
    const cleanupFailure = readPlanCleanupFailure(input.cleanupFailure);
    if (cleanupFailure) return { reason: input.reason, cleanupFailure };
  }
  const stepReport = readStepReportRejection(input);
  if (stepReport) return stepReport;
  if (input.reason !== "graph_invalid" || !("issues" in input))
    return { reason: input.reason };
  const issues = readIssues(input.issues);
  return issues === undefined
    ? { reason: input.reason }
    : {
        reason: input.reason,
        issues,
        ...("issueDetailsFiltered" in input &&
        typeof input.issueDetailsFiltered === "boolean"
          ? { issueDetailsFiltered: input.issueDetailsFiltered }
          : {}),
      };
}

function failureDetails(
  code: PlanOperationFailure["code"],
  details: unknown,
): AgentOperationDetails | undefined {
  if (code === "PAYLOAD_TOO_LARGE") return readLimit(details);
  if (code === "CONFLICT") return readRevision(details) ?? readReason(details);
  if (code === "INVALID_REQUEST" || code === "FORBIDDEN")
    return readReason(details);
  return undefined;
}

function readAssetIssue(input: unknown): Pick<AgentPlanIssueEntry, "asset"> {
  if (!isRecord(input)) return {};
  const { id, name, cause } = input;
  if (
    typeof id !== "string" ||
    id.length > 100 ||
    typeof name !== "string" ||
    name.length > 300 ||
    typeof cause !== "string" ||
    ![
      "parameter_asset_unavailable",
      "parameter_assets_too_large",
      "parameter_asset_type_unsupported",
      "parameter_ticket_changed",
      "parameter_asset_reference_unsupported",
    ].includes(cause)
  )
    return {};
  return { asset: { id, name, cause } };
}
