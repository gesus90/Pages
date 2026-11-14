import { expect, it, vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { decideWorkspaceCleanup } from "@/backend/service/agents/AgentWorkspaceCleanupDecision";
import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { recoveryFixture } from "./page84-recovery-fixture";

import type {
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";

it("authorizes the current plan executor and restricts decisions to that executor's exact obligation", async () => {
  const fixture = await recoveryFixture();
  const repository = new AgentWorkspaceCleanupRepository({
    execute: vi.fn(),
    query: vi.fn(async () => []),
  });
  const entry = {
    workspaceId: "workspace",
    workspaceName: "Workspace",
    runId: "run",
    ownerId: "owner",
    blocker: "process_scan_unavailable",
    updatedAt: "2026-11-14T12:00:00Z",
  };
  vi.spyOn(repository, "forPlan").mockResolvedValue([entry]);
  const decide = vi.spyOn(repository, "decide").mockResolvedValue();
  const release = vi.fn(async () => undefined);
  const access = vi.fn(async () => ({
    ...fixture.snapshot.plan,
    canRun: true,
    canEdit: true,
    projectName: "Synthetic",
    github: null,
  }));
  const dependencies = {
    access: { require: access },
    workspaceCleanup: repository,
    runs: { release },
  };
  const input = {
    planId: fixture.initial.planId,
    workspaceId: "workspace",
    runId: "run",
    action: "retry" as const,
  };
  await decideWorkspaceCleanup(dependencies, "owner", input);
  expect(decide).toHaveBeenCalledExactlyOnceWith(entry, "retry");
  expect(release).not.toHaveBeenCalled();
  await decideWorkspaceCleanup(dependencies, "owner", {
    ...input,
    action: "release",
  });
  expect(release).toHaveBeenCalledExactlyOnceWith("run");
  await expect(
    decideWorkspaceCleanup(dependencies, "other-owner", input),
  ).rejects.toMatchObject({ code: "plan_run_unavailable" });
  expect(decide).toHaveBeenCalledTimes(2);
});

it("releases locks and local bindings, ends the old run, and completes retained cleanup in one transaction", async () => {
  const fixture = await recoveryFixture();
  const statements: string[] = [];
  const parameters: SqlParameters[] = [];
  const run = readPlanRun(JSON.parse(JSON.stringify(fixture.failed)));
  const transaction: DatabaseTransaction = {
    query: vi.fn(async () => [[JSON.stringify(run)]]),
    execute: vi.fn(async (statement, input) => {
      statements.push(statement);
      if (input) parameters.push(input);
    }),
  };
  const repository = new AgentPlanRecoveryExecutionRepository({
    query: vi.fn(),
    transaction: async (work) => work(transaction),
  });
  await repository.retireForRestart(run);
  expect(statements[0]).toContain("DELETE FROM acp_resource_leases");
  expect(statements[1]).toContain("DELETE FROM agent_plan_workspace_locks");
  expect(statements[2]).toContain("UPDATE agent_local_session_owners");
  expect(statements[3]).toContain("UPDATE agent_plan_runs");
  expect(parameters[3]).toMatchObject({ status: "cancelled" });
  expect(statements[3]).not.toContain("recovery_revision");
  expect(statements[4]).toContain("restart_processes_ended");
});

it("accepts persisted restart evidence only for the exact verified run view", async () => {
  const fixture = await recoveryFixture();
  const original = readPlanRun(JSON.parse(JSON.stringify(fixture.failed)));
  let verifiedKey: string | null = null;
  let ended = original;
  const transaction: DatabaseTransaction = {
    query: async () => [[JSON.stringify(original)]],
    execute: async (statement, input) => {
      if (
        statement.includes("UPDATE agent_plan_runs") &&
        typeof input?.view_json === "string"
      )
        ended = readPlanRun(JSON.parse(input.view_json));
      if (
        statement.includes("INSERT INTO agent_workspace_cleanup") &&
        typeof input?.workspace_id === "string"
      )
        verifiedKey = input.workspace_id;
    },
  };
  const repository = new AgentPlanRecoveryExecutionRepository({
    transaction: async (work) => work(transaction),
    query: async (_statement, input) =>
      input?.workspace_id === verifiedKey ? [[original.id]] : [],
  });
  await repository.retireForRestart(original);
  expect(await repository.hasRestartProof(ended)).toBe(true);
  expect(await repository.hasRestartProof(original)).toBe(false);
  expect(
    await repository.hasRestartProof({
      ...ended,
      planName: "Changed after verification",
    }),
  ).toBe(false);
});
