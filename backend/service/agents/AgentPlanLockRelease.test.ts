import { expect, it, vi } from "vitest";

import { emptyAgentPlan } from "@/definition/AgentPlan";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import { releasePlanWorkspaceLocks } from "./AgentPlanLockRelease";
import { AgentPlanWorkspaceLocks } from "./AgentPlanWorkspaceLocks";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { DatabaseTransaction } from "@/backend/database/Database";

const run: AgentPlanRun = {
  id: "older-run",
  planId: "plan",
  planRevision: 1,
  planName: "Fixture",
  userId: "previous-owner",
  startedAt: "2026-01-01T00:00:00Z",
  status: "failed",
  stopRequested: false,
  steps: [],
};

function fixture(): {
  plans: Parameters<typeof releasePlanWorkspaceLocks>[0];
  release: ReturnType<typeof vi.fn>;
} {
  const plan: AgentPlanView = {
    ...emptyAgentPlan(),
    projectId: "project",
    revision: 1,
    id: "plan",
    ownerId: "current-owner",
    canEdit: true,
    projectName: "Fixture",
    github: null,
  };
  const release = vi.fn(async () => {});
  return {
    release,
    plans: {
      runs: { find: async () => run },
      access: { require: async () => plan },
      workspaceLocks: { release },
    },
  };
}

it("uses the owner's checked release for a former owner's run and forwards the atomic journal", async () => {
  const { plans, release } = fixture();
  const journal = vi.fn(async () => {});
  await releasePlanWorkspaceLocks(plans, "current-owner", run.id, {
    planId: "plan",
    journal,
  });
  expect(release).toHaveBeenCalledWith(run, "user_requested", journal);
});

it("refuses a mismatched plan before releasing anything", async () => {
  const { plans, release } = fixture();
  await expect(
    releasePlanWorkspaceLocks(plans, "current-owner", run.id, {
      planId: "other-plan",
    }),
  ).rejects.toThrow();
  expect(release).not.toHaveBeenCalled();
});

it("refuses the prior starter after ownership has changed", async () => {
  const { plans, release } = fixture();
  await expect(
    releasePlanWorkspaceLocks(plans, run.userId, run.id),
  ).rejects.toThrow();
  expect(release).not.toHaveBeenCalled();
});

function checkedRelease(): {
  locks: AgentPlanWorkspaceLocks;
  release: ReturnType<typeof vi.fn>;
  owners: ReturnType<typeof vi.fn>;
} {
  const transaction: DatabaseTransaction = {
    query: async () => [],
    execute: async () => {},
  };
  const release = vi.fn(
    async (
      runEntry: AgentPlanRun,
      verify: (connection: DatabaseTransaction) => Promise<void>,
      reason: string,
      journal?: (connection: DatabaseTransaction) => Promise<void>,
    ) => {
      expect(runEntry.id).toBe(run.id);
      expect(reason).toBe("user_requested");
      await verify(transaction);
      await journal?.(transaction);
    },
  );
  const owners = vi.fn<
    ConstructorParameters<
      typeof AgentPlanWorkspaceLocks
    >[0]["repository"]["owners"]
  >(async () => []);
  return {
    release,
    owners,
    locks: new AgentPlanWorkspaceLocks({
      engine: { isActive: () => false },
      resources: { checkEndedLeases: async () => 0 },
      repository: {
        release,
        owners,
        list: async () => [],
        leases: async () => [],
        releaseLease: async () => {},
        releaseOwner: async () => {},
      },
    }),
  };
}

it("does not release or journal an active run", async () => {
  const { locks, release } = checkedRelease();
  const journal = vi.fn(async () => {});
  await expect(
    locks.release({ ...run, status: "running" }, "user_requested", journal),
  ).rejects.toBeInstanceOf(AgentPlanRecoveryError);
  expect(release).not.toHaveBeenCalled();
  expect(journal).not.toHaveBeenCalled();
});

it("keeps the reservation when native ownership has no process-end proof", async () => {
  const { locks, owners } = checkedRelease();
  owners.mockResolvedValue([{ instanceId: "unknown-writer", proof: null }]);
  const journal = vi.fn(async () => {});
  await expect(
    locks.release(run, "user_requested", journal),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
  expect(journal).not.toHaveBeenCalled();
});

it("commits the journal only after the existing writer checks succeed", async () => {
  const { locks } = checkedRelease();
  const journal = vi.fn(async () => {});
  await locks.release(run, "user_requested", journal);
  expect(journal).toHaveBeenCalledTimes(1);
});
