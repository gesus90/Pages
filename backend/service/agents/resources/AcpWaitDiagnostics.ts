import { logEvent, withLogContext } from "@/backend/logging/Logger";

import type { AcpWaitReason } from "@/definition/AcpResource";
import type { WaitingRequest } from "./AcpAdmissionRequest";

/** Logs each changed admission reason once in the waiting run's persisted log. */
export class AcpWaitDiagnostics {
  private readonly reasons = new WeakMap<WaitingRequest, AcpWaitReason>();

  /** Reports pending requests after admission, keeping repeated scheduler ticks quiet. */
  public report(
    waiting: readonly WaitingRequest[],
    reasonOf: (request: WaitingRequest) => AcpWaitReason,
  ): void {
    for (const request of waiting) {
      const reason = reasonOf(request);
      if (this.reasons.get(request) === reason) continue;
      this.reasons.set(request, reason);
      const { runId, stepId } = request.owner;
      withLogContext(
        {
          runId: runId ?? undefined,
          stepId: stepId ?? undefined,
          jobId: undefined,
          attemptId: undefined,
        },
        () =>
          logEvent({
            level: "info",
            event: "agent.resource.waiting",
            component: "AcpResourceScheduler",
            message: `Waiting for an ACP place: ${reason}`,
            metadata: { runId, stepId, reason },
          }),
      );
    }
  }
}
