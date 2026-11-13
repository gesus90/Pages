import { AgentEmployeeError } from "./AgentEmployeeError";

import type { ChatJobState } from "@/definition/ChatJob";

/** Preserves the terminal job outcome across the conversation reply boundary. */
export class AgentJobAnswerError extends AgentEmployeeError {
  public readonly state: Exclude<ChatJobState, "running">;
  public readonly failureCode: string;

  /** Only a stable operational code may reach a chat notice or the log. */
  public constructor(
    state: Exclude<ChatJobState, "running">,
    code: string | null,
  ) {
    const safeCode =
      code && /^[a-z][a-zA-Z0-9_]{0,99}$/u.test(code) ? code : state;
    // Existing memory and automation callers keep their public unavailable error.
    super("unavailable");
    this.state = state;
    this.failureCode = safeCode;
  }

  /** An unexpected cancellation may be retried once; a person's stop is handled by its signal. */
  public get isCancelled(): boolean {
    return (
      this.state === "stopped" ||
      this.state === "interrupted" ||
      ["cancelled", "interrupted", "plan_cancelled"].includes(this.failureCode)
    );
  }
}
