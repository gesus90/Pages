import { describe, expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { RemoteError } from "@/backend/error/RemoteErrors";

import { RemoteConnectionService } from "./RemoteConnectionService";

import type { Mock } from "vitest";
import type { RemoteConnectionDependencies } from "./RemoteConnectionService";
import type { RemoteConnectionRecord } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { RemoteHostKey } from "@/definition/RemoteConnection";

const HOST_KEY_LINE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5eHl6";
const KEY: RemoteHostKey = {
  algorithm: "ssh-ed25519",
  key: "AAAAC3NzaC1lZDI1NTE5eHl6",
  fingerprint: "SHA256:x",
};

function accountOf(
  userId: string,
  overrides: Partial<AccountAccess> = {},
): AccountAccess {
  return {
    userId,
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: userId,
    lastName: "",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

const ACCOUNTS = [
  accountOf("admin", { isAdmin: true, mode: "admin" }),
  accountOf("member", { departments: ["dep-1"] }),
  accountOf("outsider", { departments: ["dep-9"] }),
  accountOf("both", { isAdmin: true, mode: "admin", departments: ["dep-1"] }),
];

function recordOf(
  overrides: Partial<RemoteConnectionRecord> = {},
): RemoteConnectionRecord {
  return {
    id: "c1",
    name: "Build",
    host: "Example.org",
    port: 22,
    username: "deploy",
    authMethod: "password",
    departmentId: "dep-1",
    hostKey: KEY,
    allowedRoots: ["/srv"],
    secrets: { password: "enc-pw", privateKey: null, passphrase: null },
    lastCheck: null,
    revision: 4,
    ...overrides,
  };
}

type LooseMock = Mock<(...args: never[]) => unknown>;

interface Harness {
  readonly service: RemoteConnectionService;
  readonly checking: Set<string>;
  readonly connections: Record<
    | "list"
    | "workspaceCounts"
    | "find"
    | "create"
    | "update"
    | "remove"
    | "saveCheck",
    LooseMock
  >;
  readonly client: Record<"probe" | "scanHostKey" | "authenticate", LooseMock>;
  readonly sessions: Record<"view" | "session" | "reset", LooseMock>;
  readonly session: unknown;
  readonly cipher: Record<"encrypt" | "decrypt", LooseMock>;
  readonly retryAfter: LooseMock;
  readonly reconnect: LooseMock;
}

function setup(
  records: readonly RemoteConnectionRecord[] = [recordOf()],
  channel?: "ui" | "mcp",
): Harness {
  const stored = new Map(records.map((record) => [record.id, record]));
  const retryAfter = vi.fn();
  const reconnect = vi.fn();
  const session = { retryAfter, reconnect };
  const connections = {
    list: vi.fn(async () => [...stored.values()]),
    workspaceCounts: vi.fn(async () => new Map([["c1", 2]])),
    find: vi.fn(async (id: string) => stored.get(id) ?? null),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    saveCheck: vi.fn(async () => undefined),
  };
  const client = {
    probe: vi.fn(async () => null as string | null),
    scanHostKey: vi.fn(async () => KEY as RemoteHostKey | string),
    authenticate: vi.fn(async () => null as string | null),
  };
  const sessions = {
    view: vi.fn(() => ({ status: "connected" })),
    session: vi.fn(() => session),
    reset: vi.fn(async () => undefined),
  };
  const cipher = {
    encrypt: vi.fn((binding: string, text: string) => `enc:${text}`),
    decrypt: vi.fn((binding: string, payload: string) => `dec:${payload}`),
  };
  const dependencies = {
    connections,
    authorization: {
      snapshot: vi.fn(async () => ({
        roles: [],
        departments: [{ id: "dep-1", name: "Dev" }],
        accounts: ACCOUNTS,
      })),
    },
    cipher,
    client,
    sessions,
    channel,
  } as unknown as RemoteConnectionDependencies;
  const checking = new Set<string>();
  const service = new RemoteConnectionService(
    dependencies,
    new SerialQueue(),
    checking,
  );
  return {
    service,
    checking,
    connections,
    client,
    sessions,
    session,
    cipher,
    retryAfter,
    reconnect,
  };
}

function dialog(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "Build",
    host: "example.org",
    port: 22,
    username: "deploy",
    authMethod: "password",
    departmentId: "dep-1",
    password: "pw",
    ...overrides,
  };
}

async function codeOf(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof RemoteError)
      return `${error.code}/${error.failure ?? ""}`;
    throw error;
  }
  return "none";
}

async function settle(checking: Set<string>): Promise<void> {
  await vi.waitFor(() => expect(checking.size).toBe(0));
}

describe("RemoteConnectionService scope", () => {
  it("shows administrators everything including stored secrets", async () => {
    const { service, checking } = setup();
    checking.add("c1");
    const scope = await service.scope("admin");
    expect(scope.canManage).toBe(true);
    expect(scope.departments).toHaveLength(1);
    expect(scope.connections[0]).toMatchObject({
      departmentName: "Dev",
      isChecking: true,
      workspaceCount: 2,
      canManage: true,
      canOpenConsole: false,
      storedSecrets: { password: true, privateKey: false, passphrase: false },
    });
  });

  it("limits members to their department without secrets", async () => {
    const { service, connections } = setup([
      recordOf(),
      recordOf({ id: "c2", departmentId: "dep-2" }),
    ]);
    connections.workspaceCounts.mockResolvedValue(new Map());
    const scope = await service.scope("member");
    expect(scope.canManage).toBe(false);
    expect(scope.departments).toEqual([]);
    expect(scope.connections).toHaveLength(1);
    expect(scope.connections[0]).toMatchObject({
      storedSecrets: null,
      canOpenConsole: true,
      workspaceCount: 0,
      isChecking: false,
    });
  });

  it("uses a null name for an unknown department", async () => {
    const { service } = setup([recordOf({ departmentId: "dep-9" })]);
    const scope = await service.scope("outsider");
    expect(scope.connections[0].departmentName).toBeNull();
  });

  it("refuses an unknown account", async () => {
    const { service } = setup();
    expect(await codeOf(service.scope("nobody"))).toBe("remote_access_denied/");
  });
});

describe("RemoteConnectionService forChannel", () => {
  it("shares storage but changes the administrator reading", async () => {
    const { service } = setup();
    const personal = service.forChannel("mcp");
    expect(personal).not.toBe(service);
    expect((await personal.scope("admin")).canManage).toBe(true);
  });
});

describe("RemoteConnectionService writes", () => {
  it("creates a connection and starts its first check", async () => {
    const { service, connections, checking, client, retryAfter } = setup();
    connections.find.mockResolvedValue(recordOf());
    const id = await service.create(
      "admin",
      dialog({ hostKey: HOST_KEY_LINE }),
    );
    expect(connections.create).toHaveBeenCalledOnce();
    const created = (
      connections.create.mock.calls as unknown[][]
    )[0][0] as RemoteConnectionRecord;
    expect(created).toMatchObject({
      id,
      revision: 1,
      secrets: { password: "enc:pw" },
    });
    expect(created.hostKey?.key).toBe(KEY.key);
    await settle(checking);
    expect(client.probe).toHaveBeenCalled();
    expect(retryAfter).not.toHaveBeenCalled();
  });

  it("refuses to create for non-managers and unknown departments", async () => {
    const { service } = setup();
    expect(await codeOf(service.create("member", dialog()))).toBe(
      "remote_management_denied/",
    );
    expect(
      await codeOf(service.create("admin", dialog({ departmentId: "nope" }))),
    ).toBe("remote_department_invalid/");
  });

  it("updates and keeps the key on the same endpoint", async () => {
    const { service, connections, sessions, checking } = setup();
    await service.update("admin", "c1", dialog({ revision: 4, password: "" }));
    const saved = (
      connections.update.mock.calls as unknown[][]
    )[0][0] as RemoteConnectionRecord;
    expect(saved).toMatchObject({ hostKey: KEY, revision: 4 });
    expect(saved.secrets.password).toBe("enc-pw");
    expect(sessions.reset).toHaveBeenCalledWith("c1");
    await settle(checking);
  });

  it("drops the key when the endpoint changes", async () => {
    const { service, connections, checking } = setup();
    await service.update(
      "admin",
      "c1",
      dialog({ revision: 4, host: "other.org" }),
    );
    const saved = (
      connections.update.mock.calls as unknown[][]
    )[0][0] as RemoteConnectionRecord;
    expect(saved.hostKey).toBeNull();
    await settle(checking);
  });

  it("rejects a stale revision, missing connection and bad department", async () => {
    const { service } = setup();
    expect(
      await codeOf(service.update("admin", "c1", dialog({ revision: 1 }))),
    ).toBe("remote_conflict/");
    expect(
      await codeOf(service.update("admin", "zz", dialog({ revision: 4 }))),
    ).toBe("remote_connection_not_found/");
    expect(
      await codeOf(
        service.update(
          "admin",
          "c1",
          dialog({ revision: 4, departmentId: "x" }),
        ),
      ),
    ).toBe("remote_department_invalid/");
  });

  it("removes a connection and resets its session", async () => {
    const { service, connections, sessions } = setup();
    await service.remove("admin", "c1", 4);
    expect(connections.remove).toHaveBeenCalledWith("c1", 4);
    expect(sessions.reset).toHaveBeenCalledWith("c1");
    expect(await codeOf(service.remove("member", "c1", 4))).toBe(
      "remote_management_denied/",
    );
  });
});

describe("RemoteConnectionService test", () => {
  it("tests a new dialog without storing", async () => {
    const { service, client } = setup();
    const result = await service.test("admin", null, dialog());
    expect(result.hostKey.code).toBe("host_key_unconfirmed");
    expect(client.scanHostKey).toHaveBeenCalled();
  });

  it("uses the stored key on the same endpoint and a typed key otherwise", async () => {
    const { service, client } = setup();
    const kept = await service.test(
      "admin",
      "c1",
      dialog({ host: "EXAMPLE.org" }),
    );
    expect(kept.authentication.state).toBe("passed");
    expect(client.authenticate).toHaveBeenCalledOnce();
    const moved = await service.test(
      "admin",
      "c1",
      dialog({ host: "other.org" }),
    );
    expect(moved.hostKey.code).toBe("host_key_unconfirmed");
    const typed = await service.test(
      "admin",
      "c1",
      dialog({ host: "other.org", hostKey: HOST_KEY_LINE }),
    );
    expect(typed.hostKey.state).toBe("passed");
  });

  it("needs a manager and an existing connection", async () => {
    const { service } = setup();
    expect(await codeOf(service.test("member", null, dialog()))).toBe(
      "remote_management_denied/",
    );
    expect(await codeOf(service.test("admin", "zz", dialog()))).toBe(
      "remote_connection_not_found/",
    );
  });
});

describe("RemoteConnectionService stored checks", () => {
  it("records a passed check", async () => {
    const { service, checking, connections, retryAfter } = setup();
    await service.testStored("admin", "c1");
    await settle(checking);
    expect(connections.saveCheck).toHaveBeenCalledWith(
      "c1",
      4,
      expect.objectContaining({ stage: null }),
    );
    expect(retryAfter).not.toHaveBeenCalled();
  });

  it("runs only one check per connection at a time", async () => {
    const { service, checking, client } = setup();
    checking.add("c1");
    await service.testStored("admin", "c1");
    expect(client.probe).not.toHaveBeenCalled();
    checking.clear();
    expect(await codeOf(service.testStored("admin", "zz"))).toBe(
      "remote_connection_not_found/",
    );
  });

  it("schedules a retry for a failed check of an unchanged connection", async () => {
    const { service, checking, client, retryAfter } = setup();
    client.probe.mockResolvedValue("unreachable_refused");
    await service.testStored("admin", "c1");
    await settle(checking);
    expect(retryAfter).toHaveBeenCalledWith("unreachable_refused");
  });

  it("skips the retry after a concurrent removal", async () => {
    const { service, checking, client, retryAfter, connections } = setup();
    client.probe.mockResolvedValue("unreachable_refused");
    connections.find
      .mockResolvedValueOnce(recordOf())
      .mockResolvedValueOnce(recordOf())
      .mockResolvedValueOnce(null);
    await service.testStored("admin", "c1");
    await settle(checking);
    expect(retryAfter).not.toHaveBeenCalled();
  });

  it("logs a failing check", async () => {
    const { service, checking, client, connections } = setup();
    connections.saveCheck.mockRejectedValue(new Error("db"));
    client.probe.mockResolvedValue(null);
    await service.testStored("admin", "c1");
    await settle(checking);
    expect(connections.saveCheck).toHaveBeenCalled();
  });
});

describe("RemoteConnectionService access checks", () => {
  it("reconnects for permitted users only", async () => {
    const { service, reconnect } = setup();
    await service.reconnect("member", "c1");
    expect(reconnect).toHaveBeenCalledOnce();
    expect(await codeOf(service.reconnect("outsider", "c1"))).toBe(
      "remote_access_denied/",
    );
  });

  it("requireManagement needs an administrator", async () => {
    const { service } = setup();
    await expect(service.requireManagement("admin")).resolves.toBeUndefined();
    expect(await codeOf(service.requireManagement("member"))).toBe(
      "remote_management_denied/",
    );
  });

  it("requireUsable checks the department and existence", async () => {
    const { service } = setup();
    expect((await service.requireUsable("member", "c1")).id).toBe("c1");
    expect(await codeOf(service.requireUsable("outsider", "c1"))).toBe(
      "remote_access_denied/",
    );
    expect(await codeOf(service.requireUsable("admin", "zz"))).toBe(
      "remote_access_denied/",
    );
  });

  it("requireConsole needs membership and a pinned key", async () => {
    const { service } = setup([
      recordOf(),
      recordOf({ id: "c3", hostKey: null }),
    ]);
    expect((await service.requireConsole("member", "c1")).id).toBe("c1");
    expect(await codeOf(service.requireConsole("admin", "c1"))).toBe(
      "remote_access_denied/",
    );
    expect(await codeOf(service.requireConsole("member", "zz"))).toBe(
      "remote_access_denied/",
    );
    expect(await codeOf(service.requireConsole("member", "c3"))).toBe(
      "remote_host_key_unconfirmed/host_key_unconfirmed",
    );
  });

  it("requireSetup needs administration and membership", async () => {
    const { service } = setup();
    expect((await service.requireSetup("both", "c1")).id).toBe("c1");
    expect(await codeOf(service.requireSetup("member", "c1"))).toBe(
      "remote_management_denied/",
    );
  });

  it("consoleTarget returns the shared session without a path", async () => {
    const { service, session } = setup();
    expect(await service.consoleTarget("member", "c1")).toEqual({
      session,
      path: null,
    });
  });

  it("scopeForRunner returns the revision", async () => {
    const { service } = setup();
    expect(await service.scopeForRunner("c1")).toBe(4);
    expect(await codeOf(service.scopeForRunner("zz"))).toBe(
      "remote_connection_not_found/",
    );
  });
});

describe("RemoteConnectionService sessionTarget", () => {
  it("returns the target with decrypted credentials", async () => {
    const { service } = setup();
    expect(await service.sessionTarget("c1")).toMatchObject({
      alias: "pages-remote-c1",
      host: "Example.org",
      hostKey: KEY,
      credentials: { method: "password", password: "dec:enc-pw" },
    });
  });

  it("names the reachability failure while no key is pinned", async () => {
    const { service, client } = setup([recordOf({ hostKey: null })]);
    client.probe.mockResolvedValueOnce("unreachable_timeout");
    expect(await codeOf(service.sessionTarget("c1"))).toBe(
      "remote_host_key_unconfirmed/unreachable_timeout",
    );
    expect(await codeOf(service.sessionTarget("c1"))).toBe(
      "remote_host_key_unconfirmed/host_key_unconfirmed",
    );
  });
});

describe("RemoteConnectionService recordConnect", () => {
  it("keeps the outcome as the latest check", async () => {
    const { service, connections } = setup();
    await service.recordConnect("c1", "not_ssh");
    expect(connections.saveCheck).toHaveBeenCalledWith(
      "c1",
      4,
      expect.objectContaining({ stage: "reachability", code: "not_ssh" }),
    );
  });

  it("ignores a removed connection", async () => {
    const { service, connections } = setup();
    await service.recordConnect("zz", null);
    expect(connections.saveCheck).not.toHaveBeenCalled();
  });
});
