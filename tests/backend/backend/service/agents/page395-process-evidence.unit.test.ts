import { beforeEach, expect, it, vi } from "vitest";

import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentWorkspaceCleanupService } from "@/backend/service/agents/AgentWorkspaceCleanupService";
import { checkSessionProcesses } from "@/backend/service/agents/AgentPlanRecovery";
import { recoveryFixture } from "./page84-recovery-fixture";

const host = vi.hoisted(() => ({
  scope: vi.fn(async () => ({ earliestStart: 1 })),
  scan: vi.fn<() => Promise<readonly never[] | null>>(async () => null),
  namespace: vi.fn(async () => true),
}));
// These cases run within one boot; a reboot boundary would end their processes.
vi.mock("@/backend/service/agents/recovery/AgentPlanBootBoundary", () => ({
  hasEndedWithReboot: async () => false,
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  findTaggedProcesses: host.scan,
  readScopeSince: host.scope,
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  settleOwnedNamespace: host.namespace,
}));
vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({
  settleManagedLocalOwner: vi.fn(async () => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  host.namespace.mockResolvedValue(true);
});

it("does not scan processes or read host uptime for a run that never started a session", async () => {
  const fixture = await recoveryFixture();
  const run = {
    ...fixture.failed,
    steps: fixture.failed.steps.map((step) => ({ ...step, session: null })),
  };
  expect(await checkSessionProcesses(run)).toMatchObject({ confirmed: true });
  expect(host.scope).not.toHaveBeenCalled();
  expect(host.scan).not.toHaveBeenCalled();
});

it("keeps legacy sessions unconfirmed when the scan cannot establish an owned process boundary", async () => {
  const fixture = await recoveryFixture();
  const checked = await checkSessionProcesses(fixture.failed);
  expect(checked).toMatchObject({
    confirmed: false,
    failure: { reason: "scan_unavailable" },
  });
  expect(host.scan).toHaveBeenCalledTimes(1);
});

it("completes a pending obligation automatically when its owned namespace actually ends", async () => {
  const fixture = await recoveryFixture();
  const run = {
    ...fixture.failed,
    steps: fixture.failed.steps.map((step) =>
      step.session
        ? {
            ...step,
            session: {
              ...step.session,
              closeout: "failed" as const,
              namespace: { pid: 42, uid: 1000, start: 1, boot: "boot" },
            },
          }
        : step,
    ),
  };
  const obligations = new AgentWorkspaceCleanupRepository({
    execute: vi.fn(),
    query: vi.fn(async () => []),
  });
  vi.spyOn(obligations, "pending").mockResolvedValue([
    {
      workspaceId: "workspace",
      workspaceName: "Workspace",
      runId: run.id,
      ownerId: run.userId,
      blocker: "process_end_unconfirmed",
      updatedAt: run.startedAt,
    },
  ]);
  vi.spyOn(obligations, "claimStop").mockResolvedValue(false);
  const record = vi.spyOn(obligations, "record").mockResolvedValue();
  const failed = vi.spyOn(obligations, "failedAttempt").mockResolvedValue();
  const find = vi.fn(async () => run);
  const release = vi.fn(async () => undefined);
  const service = new AgentWorkspaceCleanupService({
    obligations,
    runs: { find, release },
    engine: { stop: vi.fn(), isActive: () => false },
    remote: { stop: vi.fn(), withProgress: vi.fn() },
  });
  host.namespace.mockResolvedValue(false);
  await service.reconcile();
  expect(record).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
  host.namespace.mockResolvedValue(true);
  await service.reconcile();
  expect(record).toHaveBeenCalledWith(
    expect.anything(),
    "completed",
    "process_free_files_preserved",
  );
  expect(release).toHaveBeenCalledTimes(1);
  expect(find).toHaveBeenCalledTimes(2);
  expect(host.scan).not.toHaveBeenCalled();
});
