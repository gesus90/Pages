import { expect, it } from "vitest";

import {
  connectionConsoleTarget,
  connectionSetupTarget,
  workspaceConsoleTarget,
} from "@/app/components/agents/workspaces/remote/console/console-target";

import type {
  RemoteConnectionView,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

const CONNECTION: RemoteConnectionView = {
  id: "server / one",
  name: "Server",
  host: "example.test",
  port: 2222,
  username: "ada",
  authMethod: "key",
  departmentId: "dept",
  departmentName: null,
  hostKey: null,
  allowedRoots: [],
  lastCheck: null,
  isChecking: false,
  session: {
    status: "idle",
    attempts: 0,
    maximumAttempts: 10,
    nextAttemptAt: null,
    cause: null,
    connectedAt: null,
  },
  workspaceCount: 0,
  revision: 1,
  canManage: false,
  canOpenConsole: true,
  storedSecrets: null,
};

const WORKSPACE: RemoteWorkspaceView = {
  id: "workspace / one",
  name: "Project",
  connectionId: CONNECTION.id,
  connectionName: CONNECTION.name,
  path: "/work/project",
  projectId: "project",
  projectName: "Project",
  github: null,
  check: null,
  isCheckOutdated: false,
  isUsable: true,
  reason: null,
  revision: 1,
  canManage: false,
};

it("builds encoded connection and setup destinations with public address", () => {
  expect(connectionConsoleTarget(CONNECTION)).toEqual({
    endpoint:
      "/agents/workspaces/remote/connections/server%20%2F%20one/console",
    kind: "connection",
    title: "Server",
    hostName: "Server",
    address: "ada@example.test:2222",
    endpointLabel: "example.test:2222",
    directory: null,
  });
  expect(connectionSetupTarget(CONNECTION)).toMatchObject({
    endpoint: "/agents/workspaces/remote/connections/server%20%2F%20one/setup",
    kind: "setup",
    address: "ada@example.test:2222",
  });
});

it("uses the workspace directory and optional console address", () => {
  expect(workspaceConsoleTarget(WORKSPACE)).toMatchObject({
    endpoint: "/agents/workspaces/workspace%20%2F%20one/console",
    kind: "workspace",
    title: "Project",
    hostName: "Server",
    address: null,
    endpointLabel: null,
    directory: "/work/project",
  });
  expect(
    workspaceConsoleTarget({
      ...WORKSPACE,
      consoleAddress: "ada@example.test:2222",
    }),
  ).toMatchObject({
    address: "ada@example.test:2222",
    endpointLabel: "example.test:2222",
  });
});
