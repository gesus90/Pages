import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdministrationError } from "@/backend/error/AdministrationError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";

import { ManagementService } from "./ManagementService";

import type { ManagementDependencies } from "./ManagementContext";
import type { AccountAccess } from "@/definition/Authorization";
import type { ManagementOperation } from "@/definition/Management";

type Handler = (...parts: unknown[]) => Promise<unknown>;

const state = vi.hoisted(() => ({
  accounts: [] as unknown[],
  replay: vi.fn(),
  record: vi.fn(async () => undefined),
  changeable: vi.fn(async () => undefined),
  write: vi.fn<Handler>(async () => ({ id: "r", revision: "x" })),
  read: vi.fn<Handler>(async () => ({ id: "read" })),
  catalog: vi.fn<Handler>(async () => ({ projectId: "p", revision: "x" })),
  avatar: vi.fn<Handler>(async () => ({ id: "u", avatarUrl: "/a" })),
}));

vi.mock("@/backend/database/repositories/AuthorizationRepository", () => ({
  AuthorizationRepository: class {
    public snapshot = async (): Promise<{ accounts: unknown[] }> => ({
      accounts: state.accounts,
    });
  },
}));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({
    AgentOperationKeyRepository: class {},
  }),
);
vi.mock(
  "@/backend/service/InterfaceOperationJournal",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    replayInterfaceOperation: state.replay,
    recordInterfaceOperation: state.record,
  }),
);
vi.mock("./ManagementUserWrite", () => ({
  ManagementUserWrite: class {
    public changeable = state.changeable;
    public create = (input: unknown): Promise<unknown> =>
      state.write("create", input);
    public update = (id: string, input: unknown): Promise<unknown> =>
      state.write("update", id, input);
    public status = (id: string, input: unknown): Promise<unknown> =>
      state.write("status", id, input);
  },
}));
vi.mock("./ManagementUserRead", () => ({
  ManagementUserRead: class {
    public list = (input: unknown): Promise<unknown> =>
      state.read("list", input);
    public user = (id: string): Promise<unknown> => state.read("user", id);
  },
}));
vi.mock("./ManagementCatalog", () => ({
  ManagementCatalog: class {
    public group = (id: string): Promise<unknown> => state.read("group", id);
    public projectRevision = (id: string): Promise<unknown> =>
      state.catalog("revision", id);
    public createGroup = (input: unknown): Promise<unknown> =>
      state.catalog("createGroup", input);
    public updateGroup = (id: string, input: unknown): Promise<unknown> =>
      state.catalog("updateGroup", id, input);
    public members = (id: string, input: unknown): Promise<unknown> =>
      state.catalog("members", id, input);
    public departments = (id: string, input: unknown): Promise<unknown> =>
      state.catalog("departments", id, input);
  },
}));
vi.mock("./ManagementAvatar", () => ({
  managementAvatar: state.avatar,
}));

const actorAccount = {
  userId: "root",
  role: null,
  isAdmin: true,
  mode: "admin",
  isActive: true,
} as unknown as AccountAccess;
const uuid = "123e4567-e89b-42d3-a456-426614174000";

const cache = {
  invalidateUsers: vi.fn(),
  invalidateProjectMembership: vi.fn(),
  invalidateProjectsList: vi.fn(),
  invalidatePrefix: vi.fn(),
  invalidateWorkItems: vi.fn(),
};
const forChannel = vi.fn();
const audit = vi.fn();

function serviceOf(): ManagementService {
  const database = {
    runCall: async (
      work: () => Promise<unknown>,
      after: () => Promise<void>,
    ) => {
      const result = await work();
      await after();
      return result;
    },
  };
  const dependencies = {
    database,
    cache,
    hasher: {},
    invitations: {},
    agents: { forChannel },
  } as unknown as ManagementDependencies;
  const service = new ManagementService(dependencies);
  vi.spyOn(service.audit, "run").mockImplementation(async (...parts) => {
    audit(...parts);
    return parts[3]();
  });
  return service;
}

function failure(error: unknown): Promise<unknown> {
  state.replay.mockRejectedValueOnce(error);
  return serviceOf()
    .call("root", "users_update", { userId: "h1" })
    .catch((caught: unknown) => caught);
}

beforeEach(() => {
  state.accounts = [actorAccount];
  state.replay.mockReset();
  state.replay.mockResolvedValue(null);
  for (const mock of [
    state.record,
    state.changeable,
    state.write,
    state.read,
    state.catalog,
    state.avatar,
    forChannel,
    ...Object.values(cache),
  ])
    mock.mockClear();
  audit.mockReset();
  forChannel.mockReturnValue({ agents: true });
});

describe("ManagementService.call", () => {
  it("rejects parameters that are no objects", async () => {
    for (const input of [null, "x", [], 5])
      await expect(
        serviceOf().call("root", "users_list", input),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("dispatches reads without a journal", async () => {
    const service = serviceOf();
    await service.call("root", "users_list", {});
    await service.call("root", "users_read", { userId: "h1" });
    await service.call("root", "groups_read", { groupId: "g1" });
    expect(state.read.mock.calls.map((call) => call[0])).toEqual([
      "list",
      "user",
      "group",
    ]);
    expect(state.replay).not.toHaveBeenCalled();
    expect(audit.mock.calls.map((call) => call[2])).toEqual([
      "directory",
      "h1",
      "g1",
    ]);
  });

  it("rejects invalid identifiers", async () => {
    for (const request of [
      {},
      { userId: " " },
      { userId: "x".repeat(201) },
      { userId: 5 },
    ])
      await expect(
        serviceOf().call("root", "users_read", request),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      serviceOf().call("root", "groups_read", {}),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("journals every write operation", async () => {
    const service = serviceOf();
    const calls: [ManagementOperation, Record<string, unknown>][] = [
      ["users_create", {}],
      ["users_update", { userId: "h1", role: "r" }],
      ["users_set_status", { userId: "h1", role: 5 }],
      ["users_set_avatar", { userId: "h1" }],
      ["groups_create", {}],
      ["groups_update", { groupId: "g1", operationId: uuid }],
      ["project_members_set", { projectId: "p1" }],
      ["projects_set_departments", { projectId: "p1" }],
    ];
    for (const [operation, input] of calls)
      await service.call("root", operation, input);
    expect(state.record).toHaveBeenCalledTimes(8);
    expect(state.changeable).toHaveBeenCalledWith("h1", "r");
    expect(state.changeable).toHaveBeenCalledWith("h1", undefined);
    expect(state.avatar).toHaveBeenCalled();
    expect(cache.invalidateUsers).toHaveBeenCalledTimes(8);
    expect(forChannel).toHaveBeenCalledWith("mcp");
  });

  it("replays a stored receipt", async () => {
    state.replay.mockResolvedValue({ id: "stored" });
    expect(await serviceOf().call("root", "users_create", {}, "mcp")).toEqual({
      id: "stored",
    });
    expect(state.write).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("rejects invalid operation ids", async () => {
    await expect(
      serviceOf().call("root", "users_create", { operationId: 5 }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      serviceOf().call("root", "users_create", { operationId: "nope" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("requires a known actor with global access", async () => {
    await expect(
      serviceOf().call("other", "users_list", {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.accounts = [{ ...actorAccount, isAdmin: false, mode: "role" }];
    await expect(
      serviceOf().call("root", "users_list", {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ManagementService error translation", () => {
  it("translates administration errors", async () => {
    expect(await failure(new AdministrationError("notFound"))).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await failure(new AdministrationError("forbidden"))).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await failure(new AdministrationError("inUse"))).toMatchObject({
      code: "INVALID_REQUEST",
      details: { reason: "inUse" },
    });
  });

  it("translates agent employee errors", async () => {
    const codeOf = async (
      code: ConstructorParameters<typeof AgentEmployeeError>[0],
    ): Promise<unknown> =>
      ((await failure(new AgentEmployeeError(code))) as { code: string }).code;
    expect(await codeOf("notFound")).toBe("NOT_FOUND");
    expect(await codeOf("forbidden")).toBe("FORBIDDEN");
    expect(await codeOf("accessAdminRequired")).toBe("FORBIDDEN");
    expect(await codeOf("conflict")).toBe("CONFLICT");
    for (const code of [
      "invalidInput",
      "usernameTaken",
      "modelNotAllowed",
      "accessUnsupported",
      "accessModeRequired",
      "templateNameTaken",
      "inactive",
      "busy",
      "unavailable",
      "stopped",
    ] as const)
      expect(await codeOf(code)).toBe("INVALID_REQUEST");
  });

  it("translates journal and identity errors and passes others on", async () => {
    expect(await failure(new OperationReusedError())).toMatchObject({
      code: "CONFLICT",
    });
    expect(await failure(new UsernameTakenError("u"))).toMatchObject({
      details: { reason: "identity_taken" },
    });
    expect(await failure(new EmailTakenError("e"))).toMatchObject({
      details: { reason: "identity_taken" },
    });
    const other = new Error("boom");
    expect(await failure(other)).toBe(other);
  });
});

describe("ManagementService reads", () => {
  it("reads project revisions and groups for the actor", async () => {
    const service = serviceOf();
    expect(await service.projectRevision("root", "p1")).toEqual({
      projectId: "p",
      revision: "x",
    });
    expect(await service.projectRevision("root", "p1", "ui")).toBeTruthy();
    expect(forChannel).toHaveBeenLastCalledWith("ui");
    expect(await service.group("root", "g1")).toEqual({ id: "read" });
  });
});
