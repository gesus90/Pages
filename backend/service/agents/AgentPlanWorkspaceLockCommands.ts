import { z } from "zod";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { canReleasePlanWorkspaceLocks } from "@/definition/AgentPlanWorkspaceLock";

import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { readPlanControlEntry } from "./AgentPlanControlViews";

import type { Database } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanCommandResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanWorkspaceLockReleaseRequest } from "@/definition/AgentPlanWorkspaceLock";
import type { PlanControlReadService } from "./AgentPlanControlViews";

type LockCommandPlans = PlanControlReadService &
  Pick<AgentPlanService, "releaseWorkspaceLocks">;

const releaseResultSchema = z.object({
  planId: z.string(),
  revision: z.number().int().nonnegative(),
  releasedRunId: z.string(),
});

/** Validates an explicit target without trusting a client revision or cleanup assertion. */
export function readWorkspaceLockRelease(
  input: unknown,
): AgentPlanWorkspaceLockReleaseRequest {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["operationId", "planId", "runId"]);
  return {
    operation: "plans.workspace_locks.release",
    operationId: readIdentifier(fields.operationId),
    planId: readIdentifier(fields.planId),
    runId: readIdentifier(fields.runId),
  };
}

/** Journals the owner's explicit reservation release in the existing checked release transaction. */
export class AgentPlanWorkspaceLockCommands {
  private readonly database: Pick<Database, "transaction">;
  private readonly plans: LockCommandPlans;
  private readonly queue = new SerialQueue();

  public constructor(dependencies: {
    readonly database: Pick<Database, "transaction">;
    readonly plans: LockCommandPlans;
  }) {
    this.database = dependencies.database;
    this.plans = dependencies.plans;
  }

  /** Rechecks current plan ownership on first use and replay; never starts or stops a run. */
  public async write(
    userId: string,
    input: unknown,
  ): Promise<AgentPlanCommandResult> {
    const request = readWorkspaceLockRelease(input);
    return this.queue.run(async () => {
      const plan = await this.plans.view(userId, request.planId);
      if (!canReleasePlanWorkspaceLocks(plan, userId))
        throw new AgentOperationError("FORBIDDEN");
      const previous = await this.lookup(userId, request.operationId);
      if (previous) return this.replay(userId, request, previous);
      const recorder = new OperationRecorder<AgentPlanCommandResult>(
        userId,
        request,
      );
      try {
        await this.plans.releaseWorkspaceLocks(userId, request.runId, {
          planId: request.planId,
          journal: (transaction) =>
            recorder.store(transaction, {
              planId: request.planId,
              revision: plan.revision,
              releasedRunId: request.runId,
            }),
        });
      } catch (error: unknown) {
        if (error instanceof StoredOperationFound)
          return this.replay(userId, request, error.stored);
        throw error;
      }
      return this.outcome(userId, recorder.result);
    });
  }

  private async lookup(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    return this.database.transaction((transaction) =>
      new AgentOperationKeyRepository(transaction).find(userId, operationId),
    );
  }

  private async replay(
    userId: string,
    request: AgentPlanWorkspaceLockReleaseRequest,
    previous: StoredAgentOperation,
  ): Promise<AgentPlanCommandResult> {
    if (
      previous.operation !== request.operation ||
      previous.fingerprint !== fingerprintOperation(request)
    )
      throw new AgentOperationError("CONFLICT");
    const result = releaseResultSchema.parse(JSON.parse(previous.resultJson));
    return this.outcome(userId, result);
  }

  private async outcome(
    userId: string,
    result: AgentPlanCommandResult,
  ): Promise<AgentPlanCommandResult> {
    const plan = await this.plans.view(userId, result.planId);
    if (!canReleasePlanWorkspaceLocks(plan, userId))
      throw new AgentOperationError("FORBIDDEN");
    const control = await readPlanControlEntry(
      this.plans,
      userId,
      result.planId,
    );
    return {
      ...result,
      action: "plans.workspace_locks.release",
      status: control.status,
      control,
    };
  }
}
