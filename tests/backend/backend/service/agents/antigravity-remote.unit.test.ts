import { expect, it, vi } from "vitest";

import { remoteCliModels } from "@/backend/service/agents/AgentPlanRemoteCatalog";
import {
  chooseAntigravity,
  antigravityEnvironment,
} from "@/scripts/runner/antigravity.mjs";
import {
  supportsRunnerAntigravity,
  requireRunnerOutputExecutor,
} from "@/backend/service/runner/RunnerOutputCapabilities";
import { runnerCatalogSchema } from "@/definition/RunnerProtocol";
import { runnerToolFor } from "@/definition/RunnerExecution";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { ToolInventory } from "@/definition/RemoteSetup";

const TARGET: AgentPlanRemoteTarget = {
  kind: "remote",
  connectionId: "simulated-host",
  connectionRevision: 3,
  connectionName: "SIMULATED VM",
  workspaceId: "synthetic-workspace",
  workspaceRevision: 5,
  workspaceName: "Isolated workspace",
  path: "/synthetic/workspace",
};
const TOOL: ToolInventory = {
  tool: "antigravity",
  version: "1.4.4",
  authentication: "authenticated",
  catalogRevision: "exact-revision",
  acp: { status: "verified", reason: "exact_version" },
  models: [
    { id: "confirmed-flash-family", name: "Flash", reasoningEfforts: ["low"] },
  ],
};

it("binds Antigravity choices to their exact simulated host, workspace and inventory revision", () => {
  const models = remoteCliModels(TARGET, [TOOL]);
  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    provider: "antigravity",
    model: "confirmed-flash-family",
    reasoningEfforts: ["low"],
    runnerRoute: {
      connectionId: TARGET.connectionId,
      workspaceId: TARGET.workspaceId,
      catalogRevision: "exact-revision",
      tool: "antigravity",
    },
  });
  expect(models[0]?.name).toContain("SIMULATED VM");
  expect(runnerToolFor("antigravity")).toBe("antigravity");
});

it("does not offer unauthenticated, unknown or incompatible remote access", () => {
  for (const tool of [
    { ...TOOL, authentication: "not_logged_in" as const },
    { ...TOOL, authentication: "unknown" as const },
    { ...TOOL, acp: undefined },
    {
      ...TOOL,
      acp: {
        status: "incompatible" as const,
        reason: "protocol_mismatch" as const,
      },
    },
  ])
    expect(remoteCliModels(TARGET, [tool])).toEqual([]);
});

it("accepts four distinct native tools in the atomic runner inventory", () => {
  expect(
    runnerCatalogSchema.parse({
      generation: 1,
      checkedAt: "2026-10-29T00:00:00Z",
      isComplete: true,
      areToolsComplete: true,
      interpreters: [],
      removedInterpreterIds: [],
      tools: [
        TOOL,
        { tool: "codex", version: null },
        { tool: "claude", version: null },
        { tool: "opencode", version: null },
      ],
    }).tools,
  ).toHaveLength(4);
});

it("rejects missing and old runners before dispatch with no local fallback", () => {
  expect(supportsRunnerAntigravity("1.14.0")).toBe(true);
  for (const version of [undefined, "1.13.0", "1.14.0-preview", "malformed"]) {
    expect(supportsRunnerAntigravity(version)).toBe(false);
    expect(() =>
      requireRunnerOutputExecutor({
        execution: {
          version: 1,
          revision: 1,
          workspace: TARGET.path,
          timeoutSeconds: 60,
          outputBytes: 65536,
          input: "{}",
          program: {
            kind: "cli",
            route: {
              connectionId: "10000000-0000-4000-8000-000000000001",
              workspaceId: "10000000-0000-4000-8000-000000000002",
              catalogRevision: "exact-revision",
              tool: "antigravity",
            },
            model: "confirmed-flash-family",
            reasoningEffort: "low",
            prompt: "synthetic",
            access: "read_only",
          },
        },
        runnerVersion: version,
        executionLeaseVersion: 1,
        isOnline: true,
        hasCommunication: true,
        hasExactPayload: true,
        hasOutputJournal: true,
        hasLiveHistory: true,
      }),
    ).toThrow(
      expect.objectContaining({ code: "antigravity_runner_update_required" }),
    );
  }
});

it("requires exact remote selector confirmation instead of accepting a silently remapped effort", async () => {
  const client = {
    call: vi.fn(async () => ({
      configOptions: [{ id: "thinking_level", currentValue: "high" }],
    })),
  };
  await expect(
    chooseAntigravity(
      client,
      "synthetic-session",
      [{ id: "thinking_level", type: "select", options: [{ value: "low" }] }],
      {
        id: "thinking_level",
        value: "low",
        error: "plan_reasoning_unsupported",
      },
    ),
  ).rejects.toMatchObject({ pagesCode: "plan_reasoning_unsupported" });
  expect(client.call).toHaveBeenCalledWith("session/set_config_option", {
    sessionId: "synthetic-session",
    configId: "thinking_level",
    value: "low",
  });
  expect(
    antigravityEnvironment({ HOME: "/synthetic/runner" }).GEMINI_HOME,
  ).toBe("/synthetic/runner/.pages-antigravity");
});
