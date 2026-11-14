import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentWorkspaceCleanupService } from "@/backend/service/agents/AgentWorkspaceCleanupService";
import { checkSessionProcesses } from "@/backend/service/agents/AgentPlanRecovery";
import { recoveryFixture } from "./page84-recovery-fixture";

import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";
import type { Database, SqlParameters } from "@/backend/database/Database";

vi.mock("@/backend/service/agents/AgentPlanRecovery", () => ({
  checkSessionProcesses: vi.fn(),
}));
vi.mock("@/backend/service/agents/recovery/AgentPlanRecoveryScripts", () => ({
  closeRecoverySessions: vi.fn(async (run: unknown) => run),
  closeRecoveryScripts: vi.fn(async (run: unknown) => run),
}));

const NOW = Date.parse("2026-11-14T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(checkSessionProcesses).mockResolvedValue({
    confirmed: false,
    failure: null,
  });
});
afterEach(() => vi.useRealTimers());

function obligation(): AgentWorkspaceCleanup {
  return {
    workspaceId: "workspace",
    workspaceName: "Workspace",
    runId: "run",
    ownerId: "owner",
    blocker: "process_end_unconfirmed",
    updatedAt: new Date(NOW).toISOString(),
    state: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    retryStartedAt: new Date(NOW).toISOString(),
    eventRevision: 0,
    stopRevision: -1,
  };
}

function repository(): {
  repository: AgentWorkspaceCleanupRepository;
  writes: ReturnType<typeof vi.fn>;
  parameters: SqlParameters[];
} {
  const parameters: SqlParameters[] = [];
  const writes = vi.fn(async (_sql: string, input?: SqlParameters) => {
    if (input) parameters.push(input);
  });
  const database: Pick<Database, "query" | "execute"> = {
    execute: writes,
    query: vi.fn(async () => []),
  };
  return {
    repository: new AgentWorkspaceCleanupRepository(database),
    writes,
    parameters,
  };
}

it("grows the retry interval through 2s, 10s, 1m, 5m and 15m, then stops after eight failures", async () => {
  const world = repository();
  let entry = obligation();
  for (const [index, delay] of [
    2000, 10000, 60000, 300000, 900000, 900000, 900000, 900000,
  ].entries()) {
    await world.repository.failedAttempt(entry, entry.blocker);
    const saved = world.parameters.at(-1);
    expect(saved).toMatchObject({
      attempts: index + 1,
      next: Date.now() + delay,
      state: index === 7 ? "needs_decision" : "pending",
    });
    entry = { ...entry, attempts: index + 1 };
  }
  // The database preserves updated_at on a retry with the same business state.
  expect(world.writes.mock.calls[0]?.[0]).toContain("ELSE updated_at END");
});

it("checks a legacy obligation once and then needs a decision after 24 hours", async () => {
  const world = repository();
  await world.repository.failedAttempt(
    { ...obligation(), retryStartedAt: "2026-10-30T00:00:00Z" },
    "process_scan_unavailable",
  );
  expect(world.parameters.at(-1)).toMatchObject({
    attempts: 1,
    state: "needs_decision",
  });
});

it("guards unchanged state writes and completed obligations, and resets explicit retry state", async () => {
  const world = repository();
  await world.repository.record(
    obligation(),
    "pending",
    "process_end_unconfirmed",
  );
  expect(world.writes.mock.calls[0]?.[0]).toContain(
    "state IS DISTINCT FROM $state OR blocker IS DISTINCT FROM $blocker",
  );
  await world.repository.decide(obligation(), "retry");
  expect(world.writes.mock.calls[1]?.[0]).toContain(
    "event_revision = event_revision + 1",
  );
  await world.repository.decide(obligation(), "release");
  expect(world.parameters.at(-1)).toMatchObject({
    state: "completed",
    blocker: "manual_release_host_reboot_verified",
  });
});

it("performs no run reads or scans between due attempts and stops only once until a new event", async () => {
  const fixture = await recoveryFixture();
  const run = {
    ...fixture.failed,
    id: "run",
    userId: "owner",
    stopRequested: false,
  };
  const world = repository();
  let entry = obligation();
  const pending = vi
    .spyOn(world.repository, "pending")
    .mockImplementation(async () =>
      entry.state === "pending" && (entry.nextAttemptAt ?? 0) <= Date.now()
        ? [entry]
        : [],
    );
  const stop = vi
    .spyOn(world.repository, "claimStop")
    .mockImplementation(async () => {
      if (entry.eventRevision === entry.stopRevision) return false;
      entry = { ...entry, stopRevision: entry.eventRevision };
      return true;
    });
  vi.spyOn(world.repository, "failedAttempt").mockImplementation(async () => {
    entry = {
      ...entry,
      attempts: (entry.attempts ?? 0) + 1,
      nextAttemptAt: Date.now() + 10_000,
    };
  });
  const find = vi.fn(async () => run);
  const engineStop = vi.fn(async () => undefined);
  const remoteStop = vi.fn(async () => undefined);
  const service = new AgentWorkspaceCleanupService({
    obligations: world.repository,
    runs: { find, release: vi.fn() },
    engine: { stop: engineStop, isActive: () => false },
    remote: { stop: remoteStop, withProgress: vi.fn(async () => run) },
  });
  await service.reconcile();
  await service.reconcile();
  expect(find).toHaveBeenCalledTimes(1);
  expect(checkSessionProcesses).toHaveBeenCalledTimes(1);
  vi.setSystemTime(NOW + 10_000);
  await service.reconcile();
  expect(engineStop).toHaveBeenCalledTimes(1);
  expect(remoteStop).not.toHaveBeenCalled();
  entry = { ...entry, nextAttemptAt: 0, eventRevision: 1, attempts: 0 };
  await service.reconcile();
  expect(engineStop).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(3);
  expect(pending).toHaveBeenCalledTimes(4);
});

it("automatically completes only after the process boundary confirms the end", async () => {
  const fixture = await recoveryFixture();
  const world = repository();
  vi.spyOn(world.repository, "pending").mockResolvedValue([obligation()]);
  vi.spyOn(world.repository, "claimStop").mockResolvedValue(false);
  vi.mocked(checkSessionProcesses).mockResolvedValue({
    confirmed: true,
    failure: null,
  });
  const release = vi.fn(async () => undefined);
  const service = new AgentWorkspaceCleanupService({
    obligations: world.repository,
    runs: {
      find: vi.fn(async () => ({ ...fixture.failed, userId: "owner" })),
      release,
    },
    engine: { isActive: () => false, stop: vi.fn() },
    remote: { stop: vi.fn(), withProgress: vi.fn() },
  });
  await service.reconcile();
  expect(release).toHaveBeenCalledTimes(1);
  expect(world.parameters.at(-1)).toMatchObject({
    state: "completed",
    blocker: "process_free_files_preserved",
  });
});

it("treats database timestamps as UTC for the 24-hour decision boundary", async () => {
  vi.stubEnv("TZ", "Europe/Berlin");
  const world = repository();
  const timestamp = new Date(NOW - 23.5 * 3_600_000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", "");
  await world.repository.failedAttempt(
    { ...obligation(), retryStartedAt: timestamp },
    "process_end_unconfirmed",
  );
  expect(world.parameters.at(-1)).toMatchObject({ state: "pending" });
});

it("makes pending retries immediately due at startup without reopening completed obligations", async () => {
  const world = repository();
  await world.repository.resetAtStartup();
  expect(world.writes.mock.calls[0]?.[0]).toContain(
    "SET next_attempt_at = 0, attempts = 0",
  );
  expect(world.writes.mock.calls[0]?.[0]).toContain("WHERE state = 'pending'");
  expect(world.writes.mock.calls[0]?.[0]).not.toContain("updated_at =");
});
