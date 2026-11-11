/** The business failures of automations, named like the MCP HTTP codes. */
export type AutomationErrorCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "server_unavailable";

/**
 * Why an automation call was refused, as a fixed name a client can act on.
 *
 * @remarks
 * - `time_required`: a once trigger needs a time in the future to run or to be switched on.
 * - `script_forbidden`: only active administrators may use script actions.
 * - `agent_unavailable`, `plan_unavailable`, `workspace_unavailable`,
 *   `interpreter_unavailable`: the referenced record is missing or not usable by the account.
 * - `sharing_target_invalid`: the creator is no member of the project or group.
 * - `event_filter_invalid`: a plan, step, project or status of an event filter is not usable.
 * - `delete_after_success_invalid`: only once triggers may delete themselves.
 * - `run_active`: a running or waiting run blocks the deletion.
 * - `revision_conflict`: the automation changed since the expected revision.
 * - `operation_reused`: the operation ID belongs to another request.
 * - `read_only`: the account may only read.
 * - `confirmation_required`: the deletion needs its explicit confirmation.
 * - `validation`: the input does not fit the schema.
 */
export type AutomationErrorReason =
  | "time_required"
  | "script_forbidden"
  | "agent_unavailable"
  | "plan_unavailable"
  | "workspace_unavailable"
  | "interpreter_unavailable"
  | "sharing_target_invalid"
  | "event_filter_invalid"
  | "delete_after_success_invalid"
  | "run_active"
  | "revision_conflict"
  | "operation_reused"
  | "read_only"
  | "confirmation_required"
  | "validation";

const STATUS: Readonly<Record<AutomationErrorCode, number>> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  server_unavailable: 503,
};

/** A refused automation call; never carries data of a scope the caller cannot see. */
export class AutomationError extends Error {
  public readonly code: AutomationErrorCode;
  public readonly status: number;
  public readonly reason: AutomationErrorReason | null;
  /** The stored revision on a conflict. */
  public readonly currentRevision: number | null;
  /** Problems of a refused input: paths and messages, never values. */
  public readonly problems: readonly string[];

  public constructor(
    code: AutomationErrorCode,
    details: {
      readonly reason?: AutomationErrorReason;
      readonly currentRevision?: number;
      readonly problems?: readonly string[];
    } = {},
  ) {
    super(`The automation request was refused (${code}).`);
    this.name = "AutomationError";
    this.code = code;
    this.status = STATUS[code];
    this.reason = details.reason ?? null;
    this.currentRevision = details.currentRevision ?? null;
    this.problems = details.problems ?? [];
  }
}
