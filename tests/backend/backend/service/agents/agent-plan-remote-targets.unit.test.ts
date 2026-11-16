import { expect, it, vi } from "vitest";

import {
  AgentPlanRemoteTargets,
  requireRemoteRunResources,
} from "@/backend/service/agents/AgentPlanRemoteTargets";

import { emptyAgentPlan } from "@/definition/AgentPlan";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";

it("lists only authorized project targets and explains unusable choices", async () => {
  const workspaces = partial<RemoteWorkspaceService>({
    list: async () => [
      {
        id: "work",
        name: "Work",
        connectionId: "connection",
        connectionName: "Server",
        projectId: "project",
        path: "/work",
        revision: 2,
        canOpenConsole: true,
        isUsable: true,
      },
      {
        id: "denied",
        name: "Denied",
        connectionId: "connection",
        projectId: "project",
        canOpenConsole: false,
        isUsable: true,
      },
    ],
  });
  const connections = partial<RemoteConnectionService>({
    scope: async () => ({
      connections: [
        {
          id: "connection",
          name: "Server",
          revision: 3,
          hostKey: { fingerprint: "fingerprint" },
        },
      ],
    }),
  });
  const service = new AgentPlanRemoteTargets(workspaces, connections);
  const targets = await service.list("user", "project");
  expect(targets).toMatchObject([
    {
      workspaceId: "work",
      connectionId: "connection",
      workspaceRevision: 2,
      connectionRevision: 3,
    },
  ]);
  expect(targets[0]?.hostIdentity).toHaveLength(64);
  expect(await service.choices("user")).toMatchObject([
    { workspaceId: "work", isUsable: true },
    { workspaceId: "denied", isUsable: false, reason: "console_denied" },
  ]);
});

it("reauthorizes pinned remote workspace IDs before a run", async () => {
  const list = vi.fn(async () => [partial({ workspaceId: "work" })]);
  const resources = partial<AgentPlanRunResources>({
    projectId: "project",
    remoteWorkspaceIds: ["work"],
  });
  await expect(
    requireRemoteRunResources({ list }, "user", resources),
  ).resolves.toBeUndefined();
  await expect(
    requireRemoteRunResources({ list }, "user", {
      ...resources,
      remoteWorkspaceIds: ["missing"],
    }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  list.mockClear();
  await requireRemoteRunResources({ list }, "user", {
    ...resources,
    remoteWorkspaceIds: [],
  });
  expect(list).not.toHaveBeenCalled();
});

it("reauthorizes each saved remote target in the plan's project", async () => {
  const list = vi.fn(async () => [
    {
      id: "work",
      name: "Work",
      connectionId: "connection",
      projectId: "project",
      path: "/work",
      revision: 1,
      canOpenConsole: true,
    },
  ]);
  const scope = vi.fn(async () => ({
    connections: [{ id: "connection", name: "Server", revision: 1 }],
  }));
  const service = new AgentPlanRemoteTargets(
    partial({ list }),
    partial({ scope }),
  );
  const plan = {
    ...emptyAgentPlan(),
    projectId: "project",
    executionTarget: { kind: "remote" as const, workspaceId: "work" },
  };
  await expect(service.validate("user", plan)).resolves.toBeUndefined();
  await expect(
    service.validate("user", {
      ...plan,
      executionTarget: { kind: "remote", workspaceId: "missing" },
    }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  list.mockClear();
  await service.validate("user", { ...plan, executionTarget: undefined });
  expect(list).not.toHaveBeenCalled();
});
