import { expect, it } from "vitest";

import {
  remoteCliModels,
  remoteOpenRouterModels,
} from "@/backend/service/agents/AgentPlanRemoteCatalog";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { RunnerOpenRouterResult } from "@/definition/RunnerOpenRouter";
import type { ToolInventory } from "@/definition/RemoteSetup";

const TARGET = partial<AgentPlanRemoteTarget>({
  connectionId: "connection",
  connectionName: "Server",
  workspaceId: "workspace",
  workspaceName: "Work",
});

it("projects only synchronized free models with workspace-bound routes", () => {
  const catalog = partial<
    Extract<RunnerOpenRouterResult, { operation: "catalog" }>
  >({
    syncedAt: "revision",
    freeModels: [
      {
        id: "example/free",
        name: "Free",
        contextLength: 100,
        maxOutputTokens: 20,
      },
    ],
  });
  expect(remoteOpenRouterModels(TARGET, catalog)).toMatchObject([
    {
      model: "example/free",
      isFree: true,
      contextWindow: 100,
      runnerRoute: {
        connectionId: "connection",
        workspaceId: "workspace",
        catalogRevision: "revision",
      },
    },
  ]);
});

it("offers authenticated CLI models and rejects missing or unverified catalogs", () => {
  const tool = partial<ToolInventory>({
    tool: "codex",
    authentication: "authenticated",
    catalogRevision: "rev",
    models: [{ id: "model", name: "Model", reasoningEfforts: ["high"] }],
  });
  expect(remoteCliModels(TARGET, [tool])).toMatchObject([
    { model: "model", reasoning: "levels", runnerRoute: { tool: "codex" } },
  ]);
  expect(
    remoteCliModels(TARGET, [
      { ...tool, authentication: "not_logged_in" },
      { ...tool, catalogRevision: undefined },
      { ...tool, tool: "antigravity" },
    ]),
  ).toEqual([]);
});

it("requires runner support and a compatible ACP contract for OpenCode", () => {
  const tool = partial<ToolInventory>({
    tool: "opencode",
    authentication: "authenticated",
    catalogRevision: "rev",
    acp: { status: "incompatible" },
    models: [{ id: "model", name: "Model", reasoningEfforts: [] }],
  });
  expect(remoteCliModels(TARGET, [tool])).toEqual([]);
  expect(remoteCliModels(TARGET, [tool], true)).toEqual([]);
});
