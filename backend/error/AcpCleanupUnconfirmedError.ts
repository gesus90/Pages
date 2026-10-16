import { AgentError } from "./AgentErrors";

/** A failed start whose known process did not confirm exit; a tag scan alone cannot release it. */
export class AcpCleanupUnconfirmedError extends AgentError {
  public constructor() {
    super("plan_closeout_failed");
    this.name = "AcpCleanupUnconfirmedError";
  }
}
