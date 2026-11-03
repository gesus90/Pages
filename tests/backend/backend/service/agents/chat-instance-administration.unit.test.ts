import { beforeEach, expect, it, vi } from "vitest";

import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { ChatInstanceAdministrationService } from "@/backend/service/agents/ChatInstanceAdministrationService";

import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import { opaque } from "../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentAdminChanged } from "@/definition/AgentAdministration";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

const fakes = vi.hoisted(() => ({
  requireAdministrator:
    vi.fn<
      (database: unknown, userId: string, channel: string) => Promise<unknown>
    >(),
  requireConfirmation:
    vi.fn<
      (
        database: unknown,
        userId: string,
        confirmation: unknown,
      ) => Promise<void>
    >(),
  findOperation:
    vi.fn<
      (
        userId: string,
        operationId: string,
      ) => Promise<StoredAgentOperation | null>
    >(),
  insertOperation:
    vi.fn<
      (
        userId: string,
        operationId: string,
        stored: StoredAgentOperation,
      ) => Promise<void>
    >(),
  insertActivity:
    vi.fn<
      (input: {
        actorId: string;
        operation: string;
        source: string;
        result: AgentAdminChanged;
      }) => Promise<void>
    >(),
}));
vi.mock("@/backend/service/agents/AgentAdministratorAccess", () => ({
  requireAgentAdministratorActor: fakes.requireAdministrator,
}));
vi.mock("@/backend/service/agents/AgentConfirmation", () => ({
  requireAgentConfirmation: fakes.requireConfirmation,
}));
vi.mock("@/backend/service/AdministrationAccess", () => ({
  findAccount: (snapshot: { account: AccountAccess }) => snapshot.account,
}));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({
    AgentOperationKeyRepository: class {
      public find = fakes.findOperation;
      public insert = fakes.insertOperation;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/AdministrationActivityRepository",
  () => ({
    AdministrationActivityRepository: class {
      public insert = fakes.insertActivity;
    },
  }),
);

const ADMIN: User = {
  id: "admin",
  username: "admin",
  displayName: "Admin",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const ACCOUNT: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Admin",
  lastName: "Test",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: false,
};
const TRANSACTION = opaque<DatabaseTransaction>("transaction");
const IDENTITY = { userId: "admin", isAdmin: true, permissions: [] };

const CONNECTION: AgentConnectionSummary = {
  isActive: true,
  id: "connection-1",
  name: "Codex",
  provider: "codex_cli",
  accessKind: "cli_account",
  hasApiKey: false,
  testModel: "synthetic-model",
  reasoningEffort: null,
  scope: GLOBAL_CONNECTION_SCOPE,
  cli: {
    binaryFound: true,
    loggedInAt: "2026-11-01",
    accountLabel: "person@example.invalid",
    login: null,
    terminalCommand: "codex login",
  },
  checks: { auth: null, model: null },
  updatedAt: "2026-11-01",
};

const connections = {
  list: vi.fn<(actor: AccountAccess) => Promise<AgentConnectionSummary[]>>(),
  setActive:
    vi.fn<
      (actor: AccountAccess, id: string, isActive: boolean) => Promise<void>
    >(),
};
const settings = {
  getBranding: vi.fn(),
  updateCompanyName: vi.fn(),
};
const service = new ChatInstanceAdministrationService({
  database: { transaction: async (work) => work(TRANSACTION) },
  connections,
  settings,
});

beforeEach(() => {
  vi.resetAllMocks();
  fakes.requireAdministrator.mockResolvedValue({
    actor: ADMIN,
    snapshot: { account: ACCOUNT },
  });
  fakes.findOperation.mockResolvedValue(null);
  connections.list.mockResolvedValue([CONNECTION]);
  settings.getBranding.mockResolvedValue({ companyName: "Alt", logoUrl: null });
  settings.updateCompanyName.mockResolvedValue(true);
});

const DEACTIVATE = {
  operationId: "op-1",
  connectionId: "connection-1",
  isActive: false,
  expectedIsActive: true,
  confirmation: "LÖSCHEN",
};

it("leaves every other operation to the other services", async () => {
  expect(await service.handle(IDENTITY, "admin.users.list", {})).toBeNull();
  expect(await service.handle(IDENTITY, "unknown", {})).toBeNull();
  expect(fakes.requireAdministrator).not.toHaveBeenCalled();
});

it("lists connections without keys, CLI accounts or checks", async () => {
  const response = await service.handle(IDENTITY, "admin.connections.list", {});

  expect(fakes.requireAdministrator).toHaveBeenCalledWith(
    TRANSACTION,
    "admin",
    "chat",
  );
  expect(connections.list).toHaveBeenCalledWith(ACCOUNT);
  expect(response).toEqual({
    apiVersion: "1",
    result: {
      entries: [
        {
          id: "connection-1",
          name: "Codex",
          provider: "codex_cli",
          accessKind: "cli_account",
          isActive: true,
          hasApiKey: false,
          testModel: "synthetic-model",
          updatedAt: "2026-11-01",
        },
      ],
      total: 1,
      nextCursor: null,
    },
  });
  expect(JSON.stringify(response)).not.toContain("example.invalid");
});

it("reads the company name and whether a logo exists", async () => {
  settings.getBranding.mockResolvedValue({
    companyName: "Pages GmbH",
    logoUrl: "/logo?v=1",
  });

  expect(await service.handle(IDENTITY, "admin.settings.read", {})).toEqual({
    apiVersion: "1",
    result: { companyName: "Pages GmbH", hasLogo: true },
  });
});

it.each([
  ["a person who is no administrator", new AgentOperationError("FORBIDDEN")],
  ["an inactive account", new AgentOperationError("FORBIDDEN")],
])("refuses %s before any service runs", async (_, error) => {
  fakes.requireAdministrator.mockRejectedValue(error);

  await expect(
    service.handle(IDENTITY, "admin.connections.list", {}),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.handle(IDENTITY, "admin.connections.setActive", DEACTIVATE),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(connections.list).not.toHaveBeenCalled();
  expect(connections.setActive).not.toHaveBeenCalled();
});

it("translates the refusal of the regular services", async () => {
  connections.list.mockRejectedValue(new AgentAccessDeniedError());
  await expect(
    service.handle(IDENTITY, "admin.connections.list", {}),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  connections.list.mockResolvedValue([CONNECTION]);
  connections.setActive.mockRejectedValue(
    new AgentError("connection_not_found"),
  );
  await expect(
    service.handle(IDENTITY, "admin.connections.setActive", DEACTIVATE),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("disables a connection only with the typed confirmation, and audits it as an AI action", async () => {
  const response = await service.handle(
    IDENTITY,
    "admin.connections.setActive",
    DEACTIVATE,
  );

  expect(fakes.requireConfirmation).toHaveBeenCalledWith(
    TRANSACTION,
    "admin",
    "LÖSCHEN",
  );
  expect(connections.setActive).toHaveBeenCalledWith(
    ACCOUNT,
    "connection-1",
    false,
  );
  const result = {
    id: "connection-1",
    targetType: "connection",
    changed: true,
    affectedUserIds: [],
  };
  expect(response).toEqual({ apiVersion: "1", result });
  expect(fakes.insertActivity).toHaveBeenCalledWith({
    actorId: "admin",
    operation: "admin.connections.setActive",
    source: "ai",
    result,
  });
  const [userId, operationId, stored] = fakes.insertOperation.mock.calls[0];
  expect([userId, operationId]).toEqual(["admin", "op-1"]);
  expect(stored.operation).toBe("admin.connections.setActive");
  expect(stored.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  expect(stored.resultJson).toBe(JSON.stringify(result));
});

it("changes nothing without the confirmation", async () => {
  fakes.requireConfirmation.mockRejectedValue(
    new AgentOperationError("CONFIRMATION_REQUIRED"),
  );

  await expect(
    service.handle(IDENTITY, "admin.connections.setActive", {
      ...DEACTIVATE,
      confirmation: "nein",
    }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(connections.setActive).not.toHaveBeenCalled();
  expect(fakes.insertActivity).not.toHaveBeenCalled();
});

it("reports a connection that changed meanwhile, or vanished, without writing", async () => {
  await expect(
    service.handle(IDENTITY, "admin.connections.setActive", {
      ...DEACTIVATE,
      expectedIsActive: false,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.handle(IDENTITY, "admin.connections.setActive", {
      ...DEACTIVATE,
      connectionId: "missing",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(connections.setActive).not.toHaveBeenCalled();
});

it("records an unchanged state without an audit entry", async () => {
  const response = await service.handle(
    IDENTITY,
    "admin.connections.setActive",
    { ...DEACTIVATE, isActive: true },
  );

  expect(response).toMatchObject({ result: { changed: false } });
  expect(connections.setActive).not.toHaveBeenCalled();
  expect(fakes.insertActivity).not.toHaveBeenCalled();
  expect(fakes.insertOperation).toHaveBeenCalledTimes(1);
});

it("answers a repeated operation ID from the stored result and refuses another request under it", async () => {
  const stored = {
    id: "connection-1",
    targetType: "connection",
    changed: true,
    affectedUserIds: [],
  };
  await service.handle(IDENTITY, "admin.connections.setActive", DEACTIVATE);
  const { fingerprint } = fakes.insertOperation.mock.calls[0][2];
  connections.setActive.mockClear();
  fakes.findOperation.mockResolvedValue({
    operation: "admin.connections.setActive",
    fingerprint,
    resultJson: JSON.stringify(stored),
  });

  expect(
    await service.handle(IDENTITY, "admin.connections.setActive", DEACTIVATE),
  ).toEqual({ apiVersion: "1", result: stored });
  expect(connections.setActive).not.toHaveBeenCalled();

  fakes.findOperation.mockResolvedValue({
    operation: "admin.connections.setActive",
    fingerprint: "another",
    resultJson: JSON.stringify(stored),
  });
  await expect(
    service.handle(IDENTITY, "admin.connections.setActive", DEACTIVATE),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("changes the company name with the regular settings service", async () => {
  const response = await service.handle(
    IDENTITY,
    "admin.settings.setCompanyName",
    {
      operationId: "op-2",
      companyName: "  Pages GmbH ",
      expectedCompanyName: "Alt",
    },
  );

  expect(settings.updateCompanyName).toHaveBeenCalledWith(ADMIN, "Pages GmbH");
  expect(response).toMatchObject({
    result: { id: "company-name", targetType: "instance", changed: true },
  });
  expect(fakes.insertActivity).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "admin.settings.setCompanyName",
      source: "ai",
    }),
  );
});

it.each([
  [
    "a blank name",
    { companyName: "  ", expectedCompanyName: "Alt" },
    "INVALID_REQUEST",
  ],
  [
    "a stale name",
    { companyName: "Neu", expectedCompanyName: "Anders" },
    "CONFLICT",
  ],
  ["a missing field", { companyName: "Neu" }, "INVALID_REQUEST"],
  [
    "an unknown field",
    { companyName: "Neu", expectedCompanyName: "Alt", actorId: "other" },
    "INVALID_REQUEST",
  ],
])("refuses %s", async (_, parameters, code) => {
  await expect(
    service.handle(IDENTITY, "admin.settings.setCompanyName", {
      operationId: "op-3",
      ...parameters,
    }),
  ).rejects.toMatchObject({ code });
  expect(settings.updateCompanyName).not.toHaveBeenCalled();
});

it("refuses a name the settings service rejects or a person it denies", async () => {
  const request = {
    operationId: "op-4",
    companyName: "Neu",
    expectedCompanyName: "Alt",
  };
  settings.updateCompanyName.mockResolvedValueOnce(false);
  await expect(
    service.handle(IDENTITY, "admin.settings.setCompanyName", request),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

  settings.updateCompanyName.mockRejectedValueOnce(
    new InstanceSettingsDeniedError(),
  );
  await expect(
    service.handle(IDENTITY, "admin.settings.setCompanyName", request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fakes.insertActivity).not.toHaveBeenCalled();
});
