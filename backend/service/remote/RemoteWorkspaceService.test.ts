import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";

import { checkRemoteDirectory } from "./RemoteDirectoryCheck";
import { RemoteWorkspaceService } from "./RemoteWorkspaceService";

import type { Mock } from "vitest";
import type { RemoteWorkspaceDependencies } from "./RemoteWorkspaceService";
import type { RemoteConnectionRecord } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteWorkspaceRecord } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { Project, ProjectIntegration } from "@/definition/Project";
import type { RemoteHostKey } from "@/definition/RemoteConnection";

vi.mock("./RemoteDirectoryCheck", () => ({ checkRemoteDirectory: vi.fn() }));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const KEY: RemoteHostKey = {
  algorithm: "ssh-ed25519",
  key: "AAA",
  fingerprint: "SHA256:x",
};
const check = vi.mocked(checkRemoteDirectory);

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

function connectionOf(
  overrides: Partial<RemoteConnectionRecord> = {},
): RemoteConnectionRecord {
  return {
    id: "c1",
    name: "Build",
    host: "host",
    port: 22,
    username: "deploy",
    authMethod: "password",
    departmentId: "dep-1",
    hostKey: KEY,
    allowedRoots: ["/srv"],
    secrets: { password: null, privateKey: null, passphrase: null },
    lastCheck: null,
    revision: 7,
    ...overrides,
  };
}

function projectOf(id = "p1", departmentId = "dep-1"): Project {
  return {
    id,
    name: `Project ${id}`,
    departments: [{ id: departmentId, name: departmentId }],
  } as unknown as Project;
}

function integrationOf(repoUrl = "https://github.com/a/b"): ProjectIntegration {
  return {
    projectId: "p1",
    repoUrl,
    repoName: "a/b",
  } as unknown as ProjectIntegration;
}

function workspaceOf(
  overrides: Partial<RemoteWorkspaceRecord> = {},
): RemoteWorkspaceRecord {
  return {
    id: "w1",
    name: "App",
    connectionId: "c1",
    path: "/srv/app",
    projectId: "p1",
    registeredBy: "owner",
    check: { checkedAt: "t", issue: null, roots: ["/srv"] },
    revision: 3,
    ...overrides,
  };
}

interface Options {
  readonly workspaces?: readonly RemoteWorkspaceRecord[];
  readonly connections?: readonly RemoteConnectionRecord[];
  readonly projects?: readonly Project[];
  readonly integrations?: ReadonlyMap<string, ProjectIntegration>;
  readonly managed?: readonly string[];
}

type LooseMock = Mock<(...args: never[]) => unknown>;

interface Harness {
  readonly service: RemoteWorkspaceService;
  readonly repository: Record<
    "list" | "find" | "save" | "saveCheck" | "usages" | "remove",
    LooseMock
  >;
  readonly connectionRepository: Record<"list" | "find", LooseMock>;
  readonly projectRepository: Record<
    | "findAll"
    | "findById"
    | "findIntegration"
    | "findIntegrationsByProjectIds"
    | "findManagedProjectIds"
    | "isProjectManager",
    LooseMock
  >;
  readonly sessions: Record<"session" | "view", LooseMock>;
  readonly session: unknown;
}

function setup(options: Options = {}): Harness {
  const workspaces = options.workspaces ?? [workspaceOf()];
  const connections = options.connections ?? [connectionOf()];
  const projects = options.projects ?? [projectOf()];
  const integrations =
    options.integrations ?? new Map([["p1", integrationOf()]]);
  const repository = {
    list: vi.fn(async () => workspaces),
    find: vi.fn(
      async (id: string) => workspaces.find((entry) => entry.id === id) ?? null,
    ),
    save: vi.fn(async () => undefined),
    saveCheck: vi.fn(async () => undefined),
    usages: vi.fn(async () => [{ id: "a1", name: "Agent", kind: "agent" }]),
    remove: vi.fn(async () => undefined),
  };
  const connectionRepository = {
    list: vi.fn(async () => connections),
    find: vi.fn(
      async (id: string) =>
        connections.find((entry) => entry.id === id) ?? null,
    ),
  };
  const projectRepository = {
    findAll: vi.fn(async () => projects),
    findById: vi.fn(
      async (id: string) => projects.find((entry) => entry.id === id) ?? null,
    ),
    findIntegration: vi.fn(async (id: string) => integrations.get(id) ?? null),
    findIntegrationsByProjectIds: vi.fn(async () => integrations),
    findManagedProjectIds: vi.fn(async () => options.managed ?? []),
    isProjectManager: vi.fn(async (id: string) =>
      (options.managed ?? []).includes(id),
    ),
  };
  const run = vi.fn();
  const session = { run };
  const sessions = {
    session: vi.fn(() => session),
    view: vi.fn(() => ({ status: "connected" })),
  };
  const service = new RemoteWorkspaceService({
    workspaces: repository,
    connections: connectionRepository,
    authorization: {
      snapshot: vi.fn(async () => ({
        roles: [],
        departments: [],
        accounts: ACCOUNTS,
      })),
    },
    projects: projectRepository,
    sessions,
  } as unknown as RemoteWorkspaceDependencies);
  return {
    service,
    repository,
    connectionRepository,
    projectRepository,
    sessions,
    session,
  };
}

function issuesOf(saveCheck: LooseMock): (string | null)[] {
  return saveCheck.mock.calls.map(
    (call) =>
      (call as unknown as [string, number, { issue: string | null }])[2].issue,
  );
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

beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue({ path: "/srv/app", issue: null });
});

describe("RemoteWorkspaceService list", () => {
  it("describes a usable profile for a member who manages the project", async () => {
    const { service } = setup({ managed: ["p1"] });
    const [view] = await service.list("member");
    expect(view).toMatchObject({
      id: "w1",
      connectionName: "Build",
      consoleAddress: "deploy@host:22",
      projectName: "Project p1",
      github: { repoUrl: "https://github.com/a/b", repoName: "a/b" },
      check: { checkedAt: "t", issue: null },
      isCheckOutdated: false,
      isUsable: true,
      reason: null,
      canManage: true,
      canOpenConsole: true,
    });
  });

  it("does not let a plain member manage", async () => {
    expect((await setup().service.list("member"))[0].canManage).toBe(false);
  });

  it("hides profiles the person cannot use", async () => {
    expect(await setup().service.list("outsider")).toEqual([]);
    expect(await setup({ connections: [] }).service.list("member")).toEqual([]);
    expect(await setup({ projects: [] }).service.list("member")).toEqual([]);
    expect(
      await setup({ projects: [projectOf("p1", "dep-9")] }).service.list(
        "member",
      ),
    ).toEqual([]);
  });

  it("shows administrators incomplete profiles with fallbacks", async () => {
    const { service } = setup({
      connections: [],
      projects: [],
      integrations: new Map(),
    });
    const [view] = await service.list("admin");
    expect(view).toMatchObject({
      connectionName: "c1",
      consoleAddress: undefined,
      projectName: "p1",
      github: null,
      reason: "project_unavailable",
      isCheckOutdated: false,
      canManage: true,
      canOpenConsole: false,
    });
  });
});

describe("RemoteWorkspaceService list reasons", () => {
  it("explains why a profile is not usable", async () => {
    const noGithub = setup({
      integrations: new Map([["p1", integrationOf("")]]),
    });
    expect((await noGithub.service.list("admin"))[0].reason).toBe(
      "github_missing",
    );
    const noIntegration = setup({ integrations: new Map() });
    expect((await noIntegration.service.list("admin"))[0].github).toBeNull();

    const blocked = setup();
    blocked.sessions.view.mockReturnValue({ status: "blocked" });
    expect((await blocked.service.list("admin"))[0].reason).toBe(
      "connection_blocked",
    );

    const unchecked = setup({ workspaces: [workspaceOf({ check: null })] });
    const [view] = await unchecked.service.list("admin");
    expect(view).toMatchObject({
      reason: "unchecked",
      check: null,
      isCheckOutdated: false,
    });

    const failed = setup({
      workspaces: [
        workspaceOf({
          check: { checkedAt: "t", issue: "path_missing", roots: ["/srv"] },
        }),
      ],
    });
    expect((await failed.service.list("admin"))[0].reason).toBe("path_missing");
  });

  it("marks checks with other allowed directories as outdated", async () => {
    const withRoots = (
      roots: readonly string[] | null,
      connection = connectionOf(),
    ): Harness =>
      setup({
        workspaces: [
          workspaceOf({ check: { checkedAt: "t", issue: null, roots } }),
        ],
        connections: [connection],
      });
    expect(
      (await withRoots(null).service.list("admin"))[0].isCheckOutdated,
    ).toBe(true);
    expect(
      (await withRoots(["/srv", "/srv"]).service.list("admin"))[0]
        .isCheckOutdated,
    ).toBe(false);
    expect(
      (await withRoots(["/srv", "/x"]).service.list("admin"))[0]
        .isCheckOutdated,
    ).toBe(true);
    expect(
      (
        await withRoots(
          ["/home/deploy"],
          connectionOf({ allowedRoots: [] }),
        ).service.list("admin")
      )[0].isCheckOutdated,
    ).toBe(false);
  });
});

describe("RemoteWorkspaceService requireConsole", () => {
  it("returns the profile for a department member", async () => {
    expect((await setup().service.requireConsole("member", "w1")).id).toBe(
      "w1",
    );
  });

  it("refuses missing, hidden and unconfirmed profiles", async () => {
    expect(await codeOf(setup().service.requireConsole("member", "zz"))).toBe(
      "remote_workspace_not_found/",
    );
    expect(
      await codeOf(
        setup({ projects: [] }).service.requireConsole("member", "w1"),
      ),
    ).toBe("remote_workspace_not_found/");
    expect(await codeOf(setup().service.requireConsole("outsider", "w1"))).toBe(
      "remote_workspace_not_found/",
    );
    expect(
      await codeOf(
        setup({ connections: [] }).service.requireConsole("member", "w1"),
      ),
    ).toBe("remote_workspace_not_found/");
    expect(
      await codeOf(
        setup({
          connections: [connectionOf({ hostKey: null })],
        }).service.requireConsole("member", "w1"),
      ),
    ).toBe("remote_host_key_unconfirmed/host_key_unconfirmed");
  });

  it("needs the membership for administrators too", async () => {
    expect(await codeOf(setup().service.requireConsole("admin", "w1"))).toBe(
      "remote_access_denied/",
    );
  });
});

describe("RemoteWorkspaceService consoleTarget", () => {
  it("returns the checked path and session", async () => {
    const { service, session } = setup();
    expect(await service.consoleTarget("member", "w1")).toEqual({
      path: "/srv/app",
      session,
    });
  });

  it("fails when the connection vanished", async () => {
    const { service, connectionRepository } = setup();
    const record = connectionOf();
    connectionRepository.find
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(null);
    expect(await codeOf(service.consoleTarget("member", "w1"))).toBe(
      "remote_access_denied/",
    );
  });

  it("fails on an issue or a changed path", async () => {
    const { service } = setup();
    check.mockResolvedValueOnce({ path: null, issue: "path_missing" });
    expect(await codeOf(service.consoleTarget("member", "w1"))).toBe(
      "remote_check_failed/path_missing",
    );
    check.mockResolvedValueOnce({ path: "/srv/other", issue: null });
    expect(await codeOf(service.consoleTarget("member", "w1"))).toBe(
      "remote_check_failed/path_changed",
    );
  });

  it("detects changes during the check", async () => {
    const changedProfile = setup();
    changedProfile.repository.find
      .mockResolvedValueOnce(workspaceOf())
      .mockResolvedValueOnce(workspaceOf({ revision: 4 }));
    expect(
      await codeOf(changedProfile.service.consoleTarget("member", "w1")),
    ).toBe("remote_conflict/");

    const changedConnection = setup();
    const record = connectionOf();
    changedConnection.connectionRepository.find
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(connectionOf({ revision: 8 }));
    expect(
      await codeOf(changedConnection.service.consoleTarget("member", "w1")),
    ).toBe("remote_conflict/");
  });
});

describe("RemoteWorkspaceService save", () => {
  const input = {
    name: "App",
    connectionId: "c1",
    path: "/srv/../srv/app",
    projectId: "p1",
  };

  it("registers a new profile with the canonical path", async () => {
    const { service, repository } = setup({ managed: ["p1"] });
    const id = await service.save("member", null, input);
    const [record, isNew] = repository.save.mock.calls[0] as unknown as [
      RemoteWorkspaceRecord,
      boolean,
    ];
    expect(isNew).toBe(true);
    expect(record).toMatchObject({
      id,
      path: "/srv/app",
      registeredBy: "member",
      revision: 1,
      check: { issue: null, roots: ["/srv"] },
    });
  });

  it("changes an existing profile and keeps its registrant", async () => {
    const { service, repository } = setup({ managed: ["p1"] });
    expect(await service.save("member", "w1", { ...input, revision: 3 })).toBe(
      "w1",
    );
    const [record, isNew] = repository.save.mock.calls[0] as unknown as [
      RemoteWorkspaceRecord,
      boolean,
    ];
    expect(isNew).toBe(false);
    expect(record).toMatchObject({ registeredBy: "owner", revision: 3 });
  });

  it("refuses a different connection for an existing profile", async () => {
    const { service } = setup({ managed: ["p1"] });
    expect(
      await codeOf(
        service.save("member", "w1", { ...input, connectionId: "c2" }),
      ),
    ).toBe("remote_workspace_invalid/");
    expect(await codeOf(service.save("member", "zz", input))).toBe(
      "remote_workspace_not_found/",
    );
  });
});

describe("RemoteWorkspaceService save rights", () => {
  const input = {
    name: "App",
    connectionId: "c1",
    path: "/srv/../srv/app",
    projectId: "p1",
  };

  it("checks the project rights", async () => {
    expect(
      await codeOf(setup({ projects: [] }).service.save("admin", null, input)),
    ).toBe("remote_project_denied/");
    expect(await codeOf(setup().service.save("outsider", null, input))).toBe(
      "remote_project_denied/",
    );
    expect(await codeOf(setup().service.save("member", null, input))).toBe(
      "remote_project_denied/",
    );
    expect(
      await codeOf(
        setup({ integrations: new Map() }).service.save("admin", null, input),
      ),
    ).toBe("remote_project_unsupported/");
    expect(
      await codeOf(setup({ managed: [] }).service.save("member", "w1", input)),
    ).toBe("remote_project_denied/");
  });

  it("checks the connection rights", async () => {
    expect(
      await codeOf(
        setup({ connections: [] }).service.save("admin", null, input),
      ),
    ).toBe("remote_access_denied/");
    expect(
      await codeOf(
        setup({
          connections: [connectionOf({ departmentId: "dep-2" })],
          managed: ["p1"],
        }).service.save("member", null, input),
      ),
    ).toBe("remote_access_denied/");
    expect(
      await codeOf(
        setup({ connections: [connectionOf({ hostKey: null })] }).service.save(
          "admin",
          null,
          input,
        ),
      ),
    ).toBe("remote_host_key_unconfirmed/host_key_unconfirmed");
  });

  it("refuses a directory with an issue", async () => {
    const { service } = setup();
    check.mockResolvedValueOnce({
      path: "/srv/app",
      issue: "path_not_writable",
    });
    expect(await codeOf(service.save("admin", null, input))).toBe(
      "remote_check_failed/path_not_writable",
    );
    check.mockResolvedValueOnce({ path: null, issue: null });
    expect(await codeOf(service.save("admin", null, input))).toBe(
      "remote_check_failed/path_denied",
    );
  });

  it("detects a connection changed during the check", async () => {
    const { service, connectionRepository } = setup();
    connectionRepository.find
      .mockResolvedValueOnce(connectionOf())
      .mockResolvedValueOnce(connectionOf({ revision: 9 }));
    expect(await codeOf(service.save("admin", null, input))).toBe(
      "remote_conflict/",
    );
  });
});

describe("RemoteWorkspaceService check", () => {
  it("stores a passed check", async () => {
    const { service, repository } = setup();
    await service.check("member", "w1");
    expect(repository.saveCheck).toHaveBeenCalledWith(
      "w1",
      3,
      expect.objectContaining({ issue: null, roots: ["/srv"] }),
    );
  });

  it("stores an issue or a changed path", async () => {
    const { service, repository } = setup();
    check.mockResolvedValueOnce({ path: null, issue: "path_missing" });
    await service.check("member", "w1");
    check.mockResolvedValueOnce({ path: "/srv/moved", issue: null });
    await service.check("member", "w1");
    const issues = issuesOf(repository.saveCheck);
    expect(issues).toEqual(["path_missing", "path_changed"]);
  });

  it("stores the failure of a connection that cannot run the check", async () => {
    const { service, repository } = setup();
    check.mockRejectedValueOnce(
      new RemoteError("remote_check_failed", "unreachable_timeout"),
    );
    expect(await codeOf(service.check("member", "w1"))).toBe(
      "remote_check_failed/unreachable_timeout",
    );
    check.mockRejectedValueOnce(new RemoteError("remote_transport_lost"));
    await codeOf(service.check("member", "w1"));
    const issues = issuesOf(repository.saveCheck);
    expect(issues).toEqual(["unreachable_timeout", "remote_failed"]);
  });

  it("does not store other failures", async () => {
    const { service, repository } = setup();
    check.mockRejectedValueOnce(new RemoteError("remote_blocked"));
    expect(await codeOf(service.check("member", "w1"))).toBe("remote_blocked/");
    check.mockRejectedValueOnce(new Error("boom"));
    await expect(service.check("member", "w1")).rejects.toThrow("boom");
    expect(repository.saveCheck).not.toHaveBeenCalled();
  });
});

describe("RemoteWorkspaceService usages and remove", () => {
  it("names references for administrators only", async () => {
    const { service } = setup({ managed: ["p1"] });
    expect(await service.usages("both", "w1")).toEqual([
      { id: "a1", name: "Agent", kind: "agent" },
    ]);
    expect(await service.usages("member", "w1")).toEqual([
      { id: null, name: null, kind: "agent" },
    ]);
  });

  it("lets an administrator clean up a profile whose project is gone", async () => {
    const { service, repository } = setup({ projects: [] });
    await service.remove("admin", "w1", 3);
    expect(repository.remove).toHaveBeenCalledWith("w1", 3, "admin");
    expect(
      await codeOf(setup({ projects: [] }).service.usages("member", "w1")),
    ).toBe("remote_workspace_not_found/");
  });

  it("removes a profile for its project manager", async () => {
    const { service, repository } = setup({ managed: ["p1"] });
    await service.remove("member", "w1", 3);
    expect(repository.remove).toHaveBeenCalledWith("w1", 3, "member");
    expect(await codeOf(service.remove("member", "zz", 1))).toBe(
      "remote_workspace_not_found/",
    );
  });

  it("returns a service that shares storage", async () => {
    const { service } = setup();
    const personal = service.forChannel("mcp");
    expect(personal).not.toBe(service);
    expect(await personal.list("admin")).toHaveLength(1);
  });
});
