import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { checkRemoteDirectory } from "@/backend/service/remote/RemoteDirectoryCheck";
import { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";

import type { RemoteWorkspaceRecord } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import type { RemoteWorkspaceDependencies } from "@/backend/service/remote/RemoteWorkspaceService";
import type { AccountAccess } from "@/definition/Authorization";

vi.mock("@/backend/service/remote/RemoteDirectoryCheck", () => ({
  checkRemoteDirectory: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const actor: AccountAccess = {
  userId: "user",
  role: null,
  isAdmin: false,
  mode: "role",
  firstName: "A",
  lastName: "B",
  isActive: true,
  departments: ["department"],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: true,
};
const workspace = {
  id: "workspace",
  name: "Work",
  connectionId: "connection",
  path: "/work/project",
  projectId: "project",
  registeredBy: "creator",
  revision: 2,
  check: { checkedAt: "2026-01-01", issue: null, roots: ["/work"] },
};
const connection = {
  id: "connection",
  name: "Machine",
  host: "host",
  port: 22,
  username: "user",
  departmentId: "department",
  hostKey: { algorithm: "ssh-ed25519" },
  allowedRoots: ["/work"],
  revision: 3,
};
const project = {
  id: "project",
  name: "Project",
  departments: [{ id: "department", name: "Dept" }],
};
const integration = {
  projectId: "project",
  repoUrl: "https://example.test/repo",
  repoName: "repo",
};
const input = {
  name: " New ",
  connectionId: "connection",
  path: "/work/project",
  projectId: "project",
};

function harness(): {
  service: RemoteWorkspaceService;
  mocks: {
    snapshot: ReturnType<typeof vi.fn>;
    findWorkspace: ReturnType<typeof vi.fn>;
    save: ReturnType<
      typeof vi.fn<
        (record: RemoteWorkspaceRecord, isNew: boolean) => Promise<void>
      >
    >;
    saveCheck: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    findConnection: ReturnType<typeof vi.fn>;
    findProject: ReturnType<typeof vi.fn>;
    findIntegration: ReturnType<typeof vi.fn>;
    isManager: ReturnType<typeof vi.fn>;
  };
} {
  const snapshot = vi
    .fn()
    .mockResolvedValue({ accounts: [actor], roles: [], departments: [] });
  const findWorkspace = vi.fn().mockResolvedValue(workspace);
  const save = vi
    .fn<(record: RemoteWorkspaceRecord, isNew: boolean) => Promise<void>>()
    .mockResolvedValue(undefined);
  const saveCheck = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const findConnection = vi.fn().mockResolvedValue(connection);
  const findProject = vi.fn().mockResolvedValue(project);
  const findIntegration = vi.fn().mockResolvedValue(integration);
  const isManager = vi.fn().mockResolvedValue(true);
  const dependencies = {
    authorization: { snapshot },
    workspaces: {
      list: vi.fn().mockResolvedValue([workspace]),
      find: findWorkspace,
      save,
      saveCheck,
      remove,
      usages: vi
        .fn()
        .mockResolvedValue([{ id: "agent", name: "Agent", kind: "agent" }]),
    },
    connections: {
      list: vi.fn().mockResolvedValue([connection]),
      find: findConnection,
    },
    projects: {
      findAll: vi.fn().mockResolvedValue([project]),
      findById: findProject,
      findIntegration,
      isProjectManager: isManager,
      findManagedProjectIds: vi.fn().mockResolvedValue(["project"]),
      findIntegrationsByProjectIds: vi
        .fn()
        .mockResolvedValue(new Map([["project", integration]])),
    },
    sessions: {
      session: vi.fn().mockReturnValue({}),
      view: vi.fn().mockReturnValue({ status: "connected" }),
    },
  } as unknown as RemoteWorkspaceDependencies;
  return {
    service: new RemoteWorkspaceService(dependencies),
    mocks: {
      snapshot,
      findWorkspace,
      save,
      saveCheck,
      remove,
      findConnection,
      findProject,
      findIntegration,
      isManager,
    },
  };
}

beforeEach(() => {
  vi.mocked(checkRemoteDirectory).mockReset();
  vi.mocked(checkRemoteDirectory).mockResolvedValue({
    path: "/work/project",
    issue: null,
  });
});

describe("remote workspace access and listing", () => {
  it("lists usable profiles with management and console rights", async () => {
    const { service } = harness();
    expect(await service.list("user")).toEqual([
      expect.objectContaining({
        id: "workspace",
        connectionName: "Machine",
        consoleAddress: "user@host:22",
        github: { repoUrl: integration.repoUrl, repoName: "repo" },
        isUsable: true,
        isCheckOutdated: false,
        canManage: true,
        canOpenConsole: true,
      }),
    ]);
  });

  it("rejects missing or inactive accounts", async () => {
    const { service, mocks } = harness();
    mocks.snapshot.mockResolvedValueOnce({ accounts: [] });
    await expect(service.list("user")).rejects.toMatchObject({
      code: "remote_access_denied",
    });
    mocks.snapshot.mockResolvedValueOnce({
      accounts: [{ ...actor, isActive: false }],
    });
    await expect(service.list("user")).rejects.toMatchObject({
      code: "remote_access_denied",
    });
  });

  it("requires actual department membership for a console even for administrators", async () => {
    const { service, mocks } = harness();
    mocks.snapshot.mockResolvedValue({
      accounts: [{ ...actor, isAdmin: true, mode: "admin", departments: [] }],
    });
    await expect(
      service.requireConsole("user", "workspace"),
    ).rejects.toMatchObject({ code: "remote_access_denied" });
  });

  it("uses personal administrator eligibility for the MCP channel", async () => {
    const { service, mocks } = harness();
    mocks.snapshot.mockResolvedValue({
      accounts: [{ ...actor, isAdmin: true, mode: "role", departments: [] }],
    });

    expect(await service.list("user")).toEqual([]);
    expect(await service.forChannel("mcp").list("user")).toEqual([
      expect.objectContaining({
        id: "workspace",
        canManage: true,
        canOpenConsole: false,
      }),
    ]);
  });

  it("conceals inaccessible workspaces and requires a confirmed host key", async () => {
    const { service, mocks } = harness();
    mocks.findProject.mockResolvedValueOnce(null);
    await expect(
      service.requireConsole("user", "workspace"),
    ).rejects.toMatchObject({ code: "remote_workspace_not_found" });
    mocks.findConnection.mockResolvedValueOnce({
      ...connection,
      hostKey: null,
    });
    await expect(
      service.requireConsole("user", "workspace"),
    ).rejects.toMatchObject({ code: "remote_host_key_unconfirmed" });
  });

  it("anonymizes usages for project managers and allows removal", async () => {
    const { service, mocks } = harness();
    expect(await service.usages("user", "workspace")).toEqual([
      { id: null, name: null, kind: "agent" },
    ]);
    await service.remove("user", "workspace", 2);
    expect(mocks.remove).toHaveBeenCalledWith("workspace", 2, "user");
  });
});

describe("remote workspace directory checks and writes", () => {
  it("registers the canonical path after rechecking authorization", async () => {
    const { service, mocks } = harness();
    vi.mocked(checkRemoteDirectory).mockResolvedValueOnce({
      path: "/work/canonical",
      issue: null,
    });
    const id = await service.save("user", null, input);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        name: "New",
        path: "/work/canonical",
        registeredBy: "user",
        revision: 1,
      }),
      true,
    );
    expect(mocks.save.mock.calls[0]?.[0].check).toMatchObject({
      roots: ["/work"],
      issue: null,
    });
  });

  it("refuses an unsupported project or a changed connection without saving", async () => {
    const { service, mocks } = harness();
    mocks.findIntegration.mockResolvedValueOnce(null);
    await expect(service.save("user", null, input)).rejects.toMatchObject({
      code: "remote_project_unsupported",
    });
    mocks.findConnection
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce({ ...connection, revision: 4 });
    await expect(service.save("user", null, input)).rejects.toMatchObject({
      code: "remote_conflict",
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("stores path changes and classified transport failures on checks", async () => {
    const { service, mocks } = harness();
    vi.mocked(checkRemoteDirectory).mockResolvedValueOnce({
      path: "/work/other",
      issue: null,
    });
    await service.check("user", "workspace");
    expect(mocks.saveCheck).toHaveBeenLastCalledWith(
      "workspace",
      2,
      expect.objectContaining({ issue: "path_changed", roots: ["/work"] }),
    );
    const failure = new RemoteError("remote_transport_lost", "remote_failed");
    vi.mocked(checkRemoteDirectory).mockRejectedValueOnce(failure);
    await expect(service.check("user", "workspace")).rejects.toBe(failure);
    expect(mocks.saveCheck).toHaveBeenLastCalledWith(
      "workspace",
      2,
      expect.objectContaining({ issue: "remote_failed" }),
    );
  });

  it("rechecks the console target and detects a changed workspace", async () => {
    const { service, mocks } = harness();
    expect(await service.consoleTarget("user", "workspace")).toMatchObject({
      path: "/work/project",
    });
    mocks.findWorkspace
      .mockResolvedValueOnce(workspace)
      .mockResolvedValueOnce({ ...workspace, revision: 3 });
    await expect(
      service.consoleTarget("user", "workspace"),
    ).rejects.toMatchObject({ code: "remote_conflict" });
  });
});
