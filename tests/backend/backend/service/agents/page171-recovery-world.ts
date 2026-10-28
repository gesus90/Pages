import { vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";

import { RecoveryDatabase } from "./page84-recovery-database";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import type { RecoveryFixture } from "./page84-recovery-fixture";
import type { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";

/** Builds the actual recovery service around isolated, controlled boundaries. */
export function recoveryWorld(
  fixture: RecoveryFixture,
  run: AgentPlanRun,
  options: {
    readonly resources?: Pick<AcpResourceScheduler, "reconcile" | "snapshot">;
    readonly canEdit?: boolean;
    readonly engineActive?: boolean;
    readonly canStart?: boolean;
    readonly cleanupFailures?: Pick<
      AgentPlanCleanupFailureRepository,
      "append" | "latest"
    >;
  } = {},
): {
  readonly database: RecoveryDatabase;
  readonly plans: {
    readonly run: (userId: string, runId: string) => Promise<AgentPlanRun>;
  };
  readonly recovery: AgentPlanRecoveryService;
  readonly start: AgentPlanRunEngine["startRecovered"];
} {
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const db = database.asDatabase();
  const plans = {
    run: async (userId: string, runId: string): Promise<AgentPlanRun> => {
      const current = database.run(runId);
      if (current.userId !== userId) throw new AgentError("plan_access_denied");
      return current;
    },
  };
  const start = vi.fn<AgentPlanRunEngine["startRecovered"]>(
    async (...argumentsOfStart) => {
      const [userId, snapshot, , journal] = argumentsOfStart;
      if (!options.canStart) throw new Error("A release cannot start a run");
      const next = {
        ...fixture.initial,
        id: "synthetic-new-run",
        userId,
        planRevision: snapshot.plan.revision,
      };
      await db.transaction((transaction) => journal(transaction, next));
      return next;
    },
  );
  const recovery = new AgentPlanRecoveryService({
    runs: plans,
    recovery: new AgentPlanRecoveryRepository(db),
    checkpoints: new AgentPlanCheckpointRepository(db),
    cleanupFailures: options.cleanupFailures,
    execution: {
      access: {
        require: async () => ({
          ...fixture.snapshot.plan,
          canEdit: options.canEdit ?? true,
          projectName: "Synthetic project",
          github: null,
        }),
      },
      preparation: {
        prepare: async () => {
          if (!options.canStart)
            throw new Error("A release cannot prepare a run");
          return fixture.snapshot;
        },
      },
      engine: {
        startRecovered: start,
        isActive: () => options.engineActive ?? false,
      },
      planRuns: {
        latest: async () => database.run(run.id),
        hasReservation: async () =>
          [...database.stored().locks.values()].includes(run.id),
        release: async () => undefined,
      },
      executions: new AgentPlanRecoveryExecutionRepository(db),
      resources: options.resources,
    },
  });
  return { database, plans, recovery, start };
}
