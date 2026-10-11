/** Raised only after a cancelled request or process has settled, never when Stop is merely requested. */
export class AgentPlanCancelledError extends Error {
  public constructor() {
    super("Agent plan step cancellation confirmed.");
  }
}
