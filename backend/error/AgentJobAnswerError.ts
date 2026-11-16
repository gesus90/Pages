import { isTransientAgentToolFailure } from "@/definition/AgentTools";

import { AgentEmployeeError } from "./AgentEmployeeError";

import type { ChatJobFailureDetail, ChatJobState } from "@/definition/ChatJob";

/** Preserves the terminal job outcome across the conversation reply boundary. */
export class AgentJobAnswerError extends AgentEmployeeError {
  public readonly state: Exclude<ChatJobState, "running">;
  public readonly failureCode: string;
  /** Where and why the job stopped, when it is known; only stable codes. */
  public readonly detail: ChatJobFailureDetail | null;

  /** Only a stable operational code may reach a chat notice or the log. */
  public constructor(
    state: Exclude<ChatJobState, "running">,
    code: string | null,
    detail: ChatJobFailureDetail | null = null,
  ) {
    const safeCode =
      code && /^[a-z][a-zA-Z0-9_]{0,99}$/u.test(code) ? code : state;
    // Existing memory and automation callers keep their public unavailable error.
    super("unavailable");
    this.state = state;
    this.failureCode = safeCode;
    this.detail = detail;
  }

  /** An unexpected cancellation may be retried once; a person's stop is handled by its signal. */
  public get isCancelled(): boolean {
    return (
      this.state === "stopped" ||
      this.state === "interrupted" ||
      ["cancelled", "interrupted", "plan_cancelled"].includes(this.failureCode)
    );
  }

  /**
   * Whether the answer failed for a reason that a new start may not meet
   * again: a tool check that did not pass in time, or a start of the agent
   * session that was broken off before the agent worked. A missing tool, a
   * needed sign-in or an unsupported version is lasting.
   */
  public get isTransient(): boolean {
    if (this.failureCode === "agent_tool_not_ready") {
      const diagnostic = this.detail?.diagnostic;
      return (
        diagnostic === undefined || isTransientAgentToolFailure(diagnostic)
      );
    }
    return (
      this.failureCode === "plan_step_failed" && this.detail?.stage === "start"
    );
  }
}
