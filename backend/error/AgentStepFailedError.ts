import { AgentError } from "./AgentErrors";

/**
 * A step failed as `plan_step_failed` and names, for the log and a chat
 * notice, which part of the start or turn failed and with which safe code.
 * @remarks
 * Callers that only read the code see a plain `plan_step_failed`; neither
 * value carries provider text.
 */
export class AgentStepFailedError extends AgentError {
  /** The part that failed, such as `connection_status`. */
  public readonly step: string;
  /** The safe code that part reported, or `null` without one. */
  public override readonly cause: string | null;

  public constructor(step: string, cause: string | null = null) {
    super("plan_step_failed");
    this.name = "AgentStepFailedError";
    this.step = step;
    this.cause = cause;
  }
}
