import { expect, it, vi } from "vitest";

import { AgentPlanRemoteSources } from "@/backend/service/agents/AgentPlanRemoteSources";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";

const TARGET = partial<AgentPlanRemoteTarget>({
  connectionId: "connection",
  connectionName: "Server",
  workspaceId: "workspace",
  workspaceName: "Work",
});

it("retains removed interpreter identities and reports unreachable workspace state", async () => {
  const provider = vi.fn();
  const service = new AgentPlanRemoteSources(
    partial({
      targets: {
        list: async () => [TARGET],
        choices: async () => [{ workspaceId: "workspace", isUsable: false }],
      },
      runners: {
        availability: async () => null,
        catalog: async () => ({
          interpreters: [
            { id: "python", name: "Python", version: "3" },
            { id: "old", name: "Old", version: null },
          ],
          removedInterpreterIds: ["old"],
          tools: [],
          areToolsComplete: true,
        }),
        supportsPagesAccess: () => true,
        supportsOpenCode: () => false,
        supportsExactResultPayload: () => true,
      },
      provider: { catalog: provider },
    }),
  );
  const result = await service.read("user", "project");
  expect(result.statuses).toMatchObject([
    {
      problem: "remoteWorkspace",
      interpreterIds: ["workspace-python"],
      removedInterpreterIds: ["workspace-old"],
    },
  ]);
  expect(result.interpreters).toMatchObject([
    { id: "workspace-python", status: "unchecked", remoteState: "unreachable" },
    { id: "workspace-old", status: "error", remoteState: "removed" },
  ]);
  expect(provider).not.toHaveBeenCalled();
});

it("filters selected workspaces and tolerates a failed model catalog", async () => {
  const catalog = vi.fn(async () => {
    throw new Error("offline");
  });
  const service = new AgentPlanRemoteSources(
    partial({
      targets: {
        list: async () => [TARGET, { ...TARGET, workspaceId: "other" }],
        choices: async () => [{ workspaceId: "workspace", isUsable: true }],
      },
      runners: {
        availability: async () => null,
        catalog: async () => null,
        supportsPagesAccess: () => false,
        supportsOpenCode: () => false,
        supportsExactResultPayload: () => false,
      },
      provider: { catalog },
    }),
  );
  const result = await service.read("user", "project", ["workspace"]);
  expect(result.statuses).toMatchObject([
    { workspaceId: "workspace", problem: null, hasModelCatalog: false },
  ]);
  expect(catalog).toHaveBeenCalledOnce();
});

it.each([
  ["remoteRunnerUpdate", "incompatible"],
  ["remoteCatalogStale", "stale"],
  ["remoteOffline", "unreachable"],
] as const)(
  "retains inventory when the runner reports %s",
  async (problem, remoteState) => {
    const provider = vi.fn();
    const service = new AgentPlanRemoteSources(
      partial({
        targets: {
          list: async () => [TARGET],
          choices: async () => [{ workspaceId: "workspace", isUsable: true }],
        },
        runners: {
          availability: async () => problem,
          catalog: async () => ({
            interpreters: [{ id: "python", name: "Python", version: "3" }],
            tools: [],
          }),
          supportsPagesAccess: () => false,
          supportsOpenCode: () => false,
          supportsExactResultPayload: () => false,
        },
        provider: { catalog: provider },
      }),
    );
    const result = await service.read("user", "project");
    expect(result.statuses).toMatchObject([
      { problem, interpreterIds: ["workspace-python"] },
    ]);
    expect(result.interpreters).toMatchObject([
      { status: "unchecked", remoteState },
    ]);
    expect(result.models).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  },
);
