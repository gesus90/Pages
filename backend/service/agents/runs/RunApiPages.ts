import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RemotePlanStep } from "../AgentPlanRemoteExecution";
import type { RunApiCleanupRepository } from "@/backend/database/repositories/agent/RunApiCleanupRepository";
import type { RunApiClient } from "./RunApiClient";

/** Run-side capability control; the API owns credentials and authenticated runner requests. */
export class RunApiPages {
  private readonly client: RunApiClient;
  private readonly cleanup: RunApiCleanupRepository;

  public constructor(client: RunApiClient, cleanup: RunApiCleanupRepository) {
    this.client = client;
    this.cleanup = cleanup;
  }

  /** Opens only the exact saved attempt; no token or private snapshot travels over IPC. */
  public async open(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    attemptId: string,
  ): Promise<void> {
    if (remote.command.pagesAccess !== 1) return;
    await this.client.call({
      version: 1,
      operation: "openPages",
      runId: run.id,
      stepId: remote.step.id,
      attemptId,
    });
  }

  /** Persists revocation before attempting a bounded best-effort notification. */
  public async close(
    runId: string,
    stepId: string,
    attemptId: string,
  ): Promise<void> {
    await this.cleanup.enqueue({ runId, stepId, attemptId });
    try {
      await this.client.call({
        version: 1,
        operation: "closePages",
        runId,
        stepId,
        attemptId,
      });
      await this.cleanup.complete(attemptId);
    } catch (error: unknown) {
      logCaughtError("RunApiPages", error);
    }
  }
}
