import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { translatePlanError } from "@/backend/service/agents/AgentPlanOperationErrors";
import { requireRemoteResultPayload } from "@/backend/service/agents/AgentPlanRemoteResolvedCommand";
import { requireRunnerOutputExecutor } from "@/backend/service/runner/RunnerOutputCapabilities";
import { RunnerService } from "@/backend/service/runner/RunnerService";

import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerExecution } from "@/definition/RunnerExecution";

const CONNECTION = "10000000-0000-4000-8000-000000000001";
const SESSION = "10000000-0000-4000-8000-000000000002";

const COMMAND: RunnerExecution = {
  version: 1,
  revision: 1,
  workspace: "/synthetic/workspace",
  timeoutSeconds: 60,
  outputBytes: 65536,
  input: "{}",
  resultPayloadVersion: 1,
  program: {
    kind: "cli",
    route: {
      connectionId: CONNECTION,
      workspaceId: "10000000-0000-4000-8000-000000000003",
      catalogRevision: "synthetic",
      tool: "codex",
    },
    model: "synthetic",
    reasoningEffort: null,
    prompt: "synthetic",
    access: "read_only",
  },
};

it("maps the runner upgrade refusal to the public plan operation reason", () => {
  expect(
    translatePlanError(new AgentError("plan_runner_payload_update_required")),
  ).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_runner_payload_update_required" },
  });
});

it("does not impose the CLI result contract on a remote script", () => {
  const command: RunnerExecution = {
    ...COMMAND,
    resultPayloadVersion: undefined,
    program: {
      kind: "script",
      interpreter: {
        id: "synthetic",
        name: "Synthetic",
        path: "/synthetic/python",
        digest: "0".repeat(64),
        version: "synthetic",
      },
      source: "print('synthetic')",
    },
  };
  expect(() =>
    requireRunnerOutputExecutor({
      execution: command,
      executionLeaseVersion: 1,
      isOnline: true,
      hasCommunication: true,
      hasExactPayload: false,
      hasOutputJournal: false,
      hasLiveHistory: false,
    }),
  ).not.toThrow();
  expect(() =>
    requireRemoteResultPayload(command, () => {
      throw new Error("Script has no CLI capability requirement");
    }),
  ).not.toThrow();
});

it("admits exact CLI results only for the live negotiated runner and fences an older reconnect", async () => {
  let record: RunnerRecord = {
    connectionId: CONNECTION,
    runnerId: "10000000-0000-4000-8000-000000000004",
    tokenHash: "synthetic",
    connectionRevision: 1,
    state: {
      version: 1,
      sessionId: SESSION,
      sequence: 0,
      lastEventId: null,
      jobs: [],
    },
  };
  const service = new RunnerService(
    {
      find: async () => record,
      checkpoint: async (connectionId, state) => {
        if (connectionId !== CONNECTION) throw new Error("Unexpected runner");
        record = { ...record, state };
      },
      create: async () => {
        throw new Error("Unexpected registration");
      },
      remove: async () => {
        throw new Error("Unexpected removal");
      },
    },
    {
      scope: async () => {
        throw new Error("Unexpected overview");
      },
      scopeForRunner: async () => 1,
      requireUsable: async () => ({
        id: CONNECTION,
        name: "Synthetic",
        host: "synthetic.invalid",
        port: 22,
        username: "synthetic",
        authMethod: "key",
        departmentId: "synthetic",
        hostKey: null,
        allowedRoots: [],
        secrets: { password: null, privateKey: null, passphrase: null },
        lastCheck: null,
        revision: 1,
      }),
    },
  );
  const reconciliation = {
    version: 1,
    type: "reconcile",
    sessionId: SESSION,
    sequence: 0,
    jobs: [],
    executionLeaseVersion: 1,
    communicationVersion: 1,
    liveHistoryVersion: 1,
    outputJournalVersion: 2,
  };
  await service.receive(CONNECTION, reconciliation);
  await expect(
    service.enqueue("owner", CONNECTION, undefined, COMMAND),
  ).rejects.toMatchObject({ code: "plan_runner_payload_update_required" });
  expect(record.state.jobs).toHaveLength(0);

  await service.receive(CONNECTION, {
    ...reconciliation,
    resultPayloadVersion: 1,
  });
  await expect(
    service.enqueue("owner", CONNECTION, undefined, {
      ...COMMAND,
      resultPayloadVersion: undefined,
    }),
  ).rejects.toMatchObject({ code: "plan_runner_payload_update_required" });
  expect(record.state.jobs).toHaveLength(0);
  const job = await service.enqueue("owner", CONNECTION, undefined, COMMAND);
  expect(job.execution?.resultPayloadVersion).toBe(1);
  await expect(
    service.receive(CONNECTION, { ...reconciliation, jobs: [job] }),
  ).rejects.toThrow("Runner 1.13.0 is required");
  expect(service.supportsExactResultPayload(CONNECTION)).toBe(false);
  expect(record.state.jobs).toHaveLength(1);
  service.disconnected(CONNECTION);
});
