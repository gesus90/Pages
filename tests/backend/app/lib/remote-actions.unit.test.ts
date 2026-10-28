import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadRemoteOverview,
  runRemoteAction,
} from "@/app/lib/remote-actions.server";
import { RemoteError } from "@/backend/error/RemoteErrors";

import {
  ACTOR,
  formOf,
  outcomeOf,
  servicesOf,
} from "../actions/action-fixtures";

import type { FormFields } from "../actions/action-fixtures";

const logger = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logger);

const connections = {
  create: vi.fn(),
  reconnect: vi.fn(),
  remove: vi.fn(),
  scope: vi.fn(),
  test: vi.fn(),
  testStored: vi.fn(),
  update: vi.fn(),
};
const workspaces = {
  check: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
  usages: vi.fn(),
};
const installs = { views: vi.fn() };

const SERVICES = servicesOf({
  remoteConnectionService: connections,
  remoteInstallService: installs,
  remoteWorkspaceService: workspaces,
});

async function run(fields: FormFields): Promise<{
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}> {
  return outcomeOf(
    await runRemoteAction({
      formData: formOf(fields),
      services: SERVICES,
      userId: ACTOR.id,
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runRemoteAction connection intents", () => {
  it("lists the usages of a workspace", async () => {
    workspaces.usages.mockResolvedValue([{ id: "plan" }]);

    const outcome = await run({
      intent: "remote-workspace-usages",
      workspaceId: "workspace",
    });

    expect(outcome.status).toBe(200);
    expect(outcome.headers.get("Cache-Control")).toBe("no-store");
    expect(outcome.body).toEqual({
      ok: true,
      intent: "remote-workspace-usages",
      workspaceUsages: [{ id: "plan" }],
    });
    expect(workspaces.usages).toHaveBeenCalledWith("actor", "workspace");
  });

  it("tests a stored connection with new input", async () => {
    connections.test.mockResolvedValue({ ok: true });

    const outcome = await run({
      connectionId: "connection",
      input: '{"host":"example"}',
      intent: "test-connection",
    });

    expect(outcome.body).toEqual({
      ok: true,
      intent: "test-connection",
      test: { ok: true },
    });
    expect(connections.test).toHaveBeenCalledWith("actor", "connection", {
      host: "example",
    });
  });

  it("tests an unsaved connection without an identifier", async () => {
    connections.test.mockResolvedValue({ ok: false });

    await run({ connectionId: "", input: "{}", intent: "test-connection" });

    expect(connections.test).toHaveBeenCalledWith("actor", null, {});
  });

  it("updates a connection that has an identifier", async () => {
    const outcome = await run({
      connectionId: "connection",
      input: '{"name":"Host"}',
      intent: "save-connection",
    });

    expect(outcome.body).toEqual({ ok: true, intent: "save-connection" });
    expect(connections.update).toHaveBeenCalledWith("actor", "connection", {
      name: "Host",
    });
    expect(connections.create).not.toHaveBeenCalled();
  });

  it("creates a connection without an identifier", async () => {
    await run({ connectionId: "", input: "[1]", intent: "save-connection" });

    expect(connections.create).toHaveBeenCalledWith("actor", [1]);
    expect(connections.update).not.toHaveBeenCalled();
  });

  it("deletes a connection at its revision", async () => {
    const outcome = await run({
      connectionId: "connection",
      intent: "delete-connection",
      revision: "3",
    });

    expect(outcome.body).toEqual({ ok: true, intent: "delete-connection" });
    expect(connections.remove).toHaveBeenCalledWith("actor", "connection", 3);
  });

  it("checks and reconnects a stored connection", async () => {
    await run({ connectionId: "first", intent: "check-connection" });
    await run({ connectionId: "second", intent: "reconnect" });

    expect(connections.testStored).toHaveBeenCalledWith("actor", "first");
    expect(connections.reconnect).toHaveBeenCalledWith("actor", "second");
  });
});

describe("runRemoteAction workspace intents", () => {
  it("saves an existing and a new remote workspace", async () => {
    await run({
      input: '{"path":"/a"}',
      intent: "save-remote-workspace",
      workspaceId: "workspace",
    });
    await run({
      input: '{"path":"/b"}',
      intent: "save-remote-workspace",
      workspaceId: "",
    });

    expect(workspaces.save).toHaveBeenNthCalledWith(1, "actor", "workspace", {
      path: "/a",
    });
    expect(workspaces.save).toHaveBeenNthCalledWith(2, "actor", null, {
      path: "/b",
    });
  });

  it("checks and deletes a remote workspace", async () => {
    await run({ intent: "check-remote-workspace", workspaceId: "first" });
    const outcome = await run({
      intent: "delete-remote-workspace",
      revision: "7",
      workspaceId: "second",
    });

    expect(outcome.body).toEqual({
      ok: true,
      intent: "delete-remote-workspace",
    });
    expect(workspaces.check).toHaveBeenCalledWith("actor", "first");
    expect(workspaces.remove).toHaveBeenCalledWith("actor", "second", 7);
  });
});

describe("runRemoteAction input refusals", () => {
  it.each([
    ["a missing intent", {}, ""],
    ["an unknown intent", { intent: "launch" }, "launch"],
    ["an inherited property name", { intent: "constructor" }, "constructor"],
  ])("refuses %s", async (caseName, fields: FormFields, intent) => {
    const outcome = await run(fields);

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      ok: false,
      intent,
      error: "remote_connection_invalid",
      failure: null,
    });
  });

  it.each([
    ["a missing identifier", { intent: "reconnect" }],
    [
      "an overlong identifier",
      { connectionId: "x".repeat(101), intent: "reconnect" },
    ],
  ])("refuses %s", async (caseName, fields: FormFields) => {
    const outcome = await run(fields);

    expect(outcome.body).toMatchObject({ error: "remote_connection_invalid" });
    expect(connections.reconnect).not.toHaveBeenCalled();
  });

  it.each([["0"], ["1.5"], ["many"]])(
    "refuses the revision %s as a conflict",
    async (revision) => {
      const outcome = await run({
        connectionId: "connection",
        intent: "delete-connection",
        revision,
      });

      expect(outcome.status).toBe(409);
      expect(outcome.body).toMatchObject({ error: "remote_conflict" });
      expect(connections.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing", {}],
    ["too long", { input: `"${"x".repeat(50_000)}"` }],
    ["not JSON", { input: '{"password":"secret"' }],
  ])(
    "refuses connection input that is %s",
    async (caseName, input: FormFields) => {
      const outcome = await run({
        connectionId: "",
        intent: "save-connection",
        ...input,
      });

      expect(outcome.status).toBe(400);
      expect(JSON.stringify(outcome.body)).not.toContain("secret");
      expect(outcome.body).toMatchObject({
        error: "remote_connection_invalid",
      });
      expect(connections.create).not.toHaveBeenCalled();
    },
  );

  it("refuses unreadable workspace input with the workspace code", async () => {
    const outcome = await run({
      input: "{",
      intent: "save-remote-workspace",
      workspaceId: "",
    });

    expect(outcome.body).toMatchObject({ error: "remote_workspace_invalid" });
    expect(workspaces.save).not.toHaveBeenCalled();
  });
});

describe("runRemoteAction failures", () => {
  it("answers a remote error with its code, failure and status", async () => {
    const error = new RemoteError("remote_check_failed", "host_unknown");
    connections.testStored.mockRejectedValue(error);

    const outcome = await run({
      connectionId: "c",
      intent: "check-connection",
    });

    expect(outcome.status).toBe(409);
    expect(outcome.headers.get("Cache-Control")).toBe("no-store");
    expect(outcome.body).toEqual({
      ok: false,
      intent: "check-connection",
      error: "remote_check_failed",
      failure: "host_unknown",
    });
    expect(logger.logCaughtError).toHaveBeenCalledWith("agent_remote", error);
  });

  it("answers an unexpected error as a general failure", async () => {
    connections.reconnect.mockRejectedValue(new Error("ssh said secret"));

    const outcome = await run({ connectionId: "c", intent: "reconnect" });

    expect(outcome.status).toBe(500);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "reconnect",
      error: "general",
      failure: null,
    });
  });

  it("passes a thrown response on and keeps it uncacheable", async () => {
    connections.reconnect.mockRejectedValue(
      new Response("denied", {
        headers: { "Cache-Control": "max-age=60", "X-Reason": "kept" },
        status: 403,
      }),
    );

    const response = await runRemoteAction({
      formData: formOf({ connectionId: "c", intent: "reconnect" }),
      services: SERVICES,
      userId: ACTOR.id,
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Reason")).toBe("kept");
    expect(await response.text()).toBe("denied");
  });
});

const CONNECTION = {
  allowedRoots: ["/srv"],
  host: "host.invalid",
  hostKey: "ssh-ed25519 key",
  id: "first",
  name: "First",
  username: "deploy",
};

it("loads the overview with installation states for a manager", async () => {
  const second = {
    ...CONNECTION,
    allowedRoots: [],
    hostKey: null,
    id: "second",
    name: "Second",
  };
  connections.scope.mockResolvedValue({
    canManage: true,
    connections: [CONNECTION, second],
    departments: [{ id: "department" }],
  });
  workspaces.list.mockResolvedValue([{ id: "workspace" }]);
  installs.views.mockResolvedValue({ first: { state: "installed" } });

  const overview = await loadRemoteOverview(SERVICES, ACTOR.id);

  expect(connections.scope).toHaveBeenCalledWith("actor");
  expect(workspaces.list).toHaveBeenCalledWith("actor");
  expect(installs.views).toHaveBeenCalledWith([CONNECTION, second]);
  expect(overview).toEqual({
    canManageConnections: true,
    connections: [CONNECTION, second],
    departments: [{ id: "department" }],
    workspaces: [{ id: "workspace" }],
    choices: [
      {
        id: "first",
        name: "First",
        host: "host.invalid",
        hasHostKey: true,
        allowedRoots: ["/srv"],
      },
      {
        id: "second",
        name: "Second",
        host: "host.invalid",
        hasHostKey: false,
        allowedRoots: ["/home/deploy"],
      },
    ],
    installs: { first: { state: "installed" } },
  });
});

it("loads the overview without installation states for a non-manager", async () => {
  connections.scope.mockResolvedValue({
    canManage: false,
    connections: [],
    departments: [],
  });
  workspaces.list.mockResolvedValue([]);

  const overview = await loadRemoteOverview(SERVICES, ACTOR.id);

  expect(installs.views).not.toHaveBeenCalled();
  expect(overview).toEqual({
    canManageConnections: false,
    connections: [],
    departments: [],
    workspaces: [],
    choices: [],
    installs: {},
  });
});
