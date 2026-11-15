import { beforeEach, expect, it, vi } from "vitest";

import {
  controlOwnedScript,
  executeOwnedScript,
  startPlanScriptOwner,
} from "@/backend/service/agents/AgentPlanScriptOwner";
import { scriptRuntimeDirectory } from "@/backend/service/agents/AgentPlanScriptResources";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

const instanceId = "20000000-0000-4000-8000-000000000002";
const scope = {
  runId: "30000000-0000-4000-8000-000000000003",
  stepId: "40000000-0000-4000-8000-000000000004",
};

const boundary = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  execute: vi.fn(),
  spawn: vi.fn(),
  marker: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ readFile: boundary.marker }));
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

beforeEach(() => {
  vi.resetAllMocks();
  boundary.marker.mockResolvedValue(instanceId);
});

function scopedRecord(): AgentPlanScriptRun {
  return {
    attemptId: "10000000-0000-4000-8000-000000000001",
    instanceId,
    interpreterProfileId: "bash",
    directory: "/synthetic/work",
    userId: "owner",
    uid: 1000,
    gid: 1000,
    processId: 123,
    startedAt: "2026-11-15T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    closeout: "pending",
    stdout: null,
    stderr: "",
    temporaryScope: scope,
  };
}

it("starts the owner of a script whose resources lie in the run's temporary directory", async () => {
  const record = scopedRecord();
  const directory = scriptRuntimeDirectory(instanceId, scope);
  expect(directory).not.toBe(scriptRuntimeDirectory(instanceId));
  const finished = { ...record, endedAt: "2026-11-15T00:01:00.000Z" };
  boundary.read.mockImplementation(async (file: string) =>
    file.endsWith("launch.json")
      ? {
          runId: "run-scoped",
          record,
          resources: directory,
          sharedEnvironment: "/synthetic/shared-env",
          program: "/synthetic/bash",
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

it("follows the capture of a scoped script in its own directory", async () => {
  const record = scopedRecord();
  const directory = scriptRuntimeDirectory(instanceId, scope);
  const finished = { ...record, endedAt: "2026-11-15T00:01:00.000Z" };
  boundary.read.mockResolvedValueOnce(record).mockResolvedValueOnce(finished);
  const result = await executeOwnedScript({
    runId: "run-scoped",
    record,
    resources: directory,
    sharedEnvironment: "/synthetic/shared-env",
    program: "/synthetic/bash",
    input: "{}",
    timeoutSeconds: 60,
    signal: new AbortController().signal,
    save: vi.fn(),
    claimStart: vi.fn(),
  });
  expect(result).toEqual(finished);
  expect(boundary.read).toHaveBeenCalledWith(`${directory}/progress.json`);
  expect(boundary.spawn).not.toHaveBeenCalled();
});

it("writes the control of a scoped script into its own directory", async () => {
  const directory = scriptRuntimeDirectory(instanceId, scope);
  await controlOwnedScript(instanceId, "pause", scope);
  expect(boundary.marker).toHaveBeenCalledWith(`${directory}/owner`, "utf8");
  expect(boundary.write).toHaveBeenCalledWith(`${directory}/control.json`, {
    action: "pause",
  });
});
