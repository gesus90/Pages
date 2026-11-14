import { expect, it, vi } from "vitest";

import {
  executeOwnedScript,
  startPlanScriptOwner,
} from "@/backend/service/agents/AgentPlanScriptOwner";
import { scriptRuntimeDirectory } from "@/backend/service/agents/AgentPlanScriptResources";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

const boundary = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  execute: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "20000000-0000-4000-8000-000000000002"),
}));
vi.mock("node:child_process", () => ({ execFile: boundary.spawn }));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: boundary.read,
  writeLocalRecord: boundary.write,
}));
vi.mock("@/backend/service/agents/AgentPlanScriptProcess", () => ({
  executeScriptProcess: boundary.execute,
}));
vi.mock("@/backend/agents/cli/CliNamespaceControl", () => ({
  controlOwnedNamespace: vi.fn(),
}));

function record(): AgentPlanScriptRun {
  return {
    attemptId: "10000000-0000-4000-8000-000000000001",
    instanceId: "20000000-0000-4000-8000-000000000002",
    interpreterProfileId: "node",
    directory: "/synthetic/work",
    userId: "owner",
    uid: 1000,
    gid: 1000,
    processId: 123,
    startedAt: "2026-11-13T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    closeout: "pending",
    stdout: null,
    stderr: "",
  };
}

it("reattaches the same captured script after service restart without spawning or replaying it", async () => {
  const previous = record();
  const finished: AgentPlanScriptRun = {
    ...previous,
    endedAt: "2026-11-13T00:01:00.000Z",
    exitCode: 0,
    closeout: "confirmed",
    stdout: "same output",
  };
  boundary.read.mockResolvedValueOnce(previous).mockResolvedValueOnce(finished);
  const save = vi.fn();
  const claimStart = vi.fn();
  const result = await executeOwnedScript({
    runId: "run",
    record: previous,
    resources: scriptRuntimeDirectory(previous.instanceId),
    program: "/synthetic/node",
    input: "{}",
    timeoutSeconds: 60,
    signal: new AbortController().signal,
    save,
    claimStart,
  });
  expect(result).toEqual(finished);
  expect(save).toHaveBeenCalledWith(finished);
  expect(boundary.spawn).not.toHaveBeenCalled();
  expect(claimStart).not.toHaveBeenCalled();
});

it("keeps the final bounded capture outside the plan-service lifetime", async () => {
  const previous = record();
  const directory = scriptRuntimeDirectory(previous.instanceId);
  const finished: AgentPlanScriptRun = {
    ...previous,
    endedAt: "2026-11-13T00:01:00.000Z",
    closeout: "confirmed",
    stdout: "preserved",
  };
  boundary.read.mockImplementation(async (file: string) =>
    file.endsWith("launch.json")
      ? {
          runId: "run-owner",
          record: previous,
          resources: directory,
          program: "/synthetic/node",
          input: "{}",
          timeoutSeconds: 60,
        }
      : { action: "resume" },
  );
  boundary.execute.mockResolvedValueOnce(finished);
  await startPlanScriptOwner(directory);
  expect(boundary.execute).toHaveBeenCalledOnce();
  expect(boundary.write).toHaveBeenCalledWith(
    `${directory}/progress.json`,
    finished,
  );
});
