import { createHash } from "node:crypto";

import { afterEach, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { Database } from "@/backend/database/Database";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { logCaughtError } from "@/backend/logging/Logger";
import { UserService } from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";

import { SessionService } from "./SessionService";

import type { AgentBrowserSessions } from "@/backend/service/chat/browser/AgentBrowserSessions";
import type { User } from "@/definition/User";

vi.mock("@/backend/database/Database", () => ({
  Database: { connect: async () => ({}) },
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TOUCH_INTERVAL_MS = 60_000;

const employee: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada Lovelace",
  role: ROLE.EMPLOYEE,
  isActive: true,
  mustChangePassword: false,
};

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createService(): Promise<{
  readonly service: SessionService;
  readonly repository: SessionRepository;
  readonly userService: UserService;
}> {
  const database = await Database.connect("postgres://simulated");
  const repository = new SessionRepository(database);
  const userService = new UserService(
    new UserRepository({
      query: vi.fn(),
      execute: vi.fn(),
      transaction: async () => {
        throw new Error("unexpected transaction");
      },
    }),
    new PermissionService(),
  );

  return {
    service: new SessionService(repository, userService),
    repository,
    userService,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it("stores only the hash of a new random session token and returns the token once", async () => {
  const { service, repository } = await createService();
  const insert = vi.spyOn(repository, "insert").mockResolvedValue(undefined);

  const token = await service.createSession("user-1", "Chrome/120");

  expect(token).toMatch(TOKEN_PATTERN);
  const [session] = insert.mock.calls[0];
  expect(session.id).toMatch(UUID_PATTERN);
  expect(session).toEqual({
    id: session.id,
    userId: "user-1",
    tokenHash: hashOf(token),
    lifetimeDays: 14,
    userAgent: "Chrome/120",
  });
});

it("creates a session without a user agent when none is supplied", async () => {
  const { service, repository } = await createService();
  const insert = vi.spyOn(repository, "insert").mockResolvedValue(undefined);

  await service.createSession("user-1");

  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({ userAgent: undefined }),
  );
});

it("resolves no user for a missing, empty or NUL-containing token", async () => {
  const { service, repository } = await createService();
  const lookup = vi.spyOn(repository, "findUserIdByTokenHash");

  expect(await service.authenticate(null)).toBeNull();
  expect(await service.authenticate("")).toBeNull();
  expect(await service.authenticate("token\u0000suffix")).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
});

it("resolves no user for an agent browser token when no agent sessions are wired", async () => {
  const { service } = await createService();

  expect(await service.authenticate("pabs_unknown")).toBeNull();
});

it("delegates agent browser tokens to the wired agent sessions", async () => {
  const { service } = await createService();
  const agentUser: User = { ...employee, id: "agent-1", isAgent: true };
  const agentBrowsers: Pick<AgentBrowserSessions, "authenticate" | "revoke"> = {
    authenticate: vi.fn().mockResolvedValue(agentUser),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  service.setAgentBrowsers(agentBrowsers);

  expect(await service.authenticate("pabs_issued")).toEqual(agentUser);
  expect(agentBrowsers.authenticate).toHaveBeenCalledWith("pabs_issued");
});

it("resolves no user for an unknown token", async () => {
  const { service, repository, userService } = await createService();
  vi.spyOn(repository, "findUserIdByTokenHash").mockResolvedValue(null);
  const getById = vi.spyOn(userService, "getById");

  expect(await service.authenticate("unknown-token")).toBeNull();
  expect(getById).not.toHaveBeenCalled();
});

it("resolves no user when the session belongs to a missing, inactive or agent account", async () => {
  const { service, repository, userService } = await createService();
  vi.spyOn(repository, "findUserIdByTokenHash").mockResolvedValue("user-1");
  const getById = vi.spyOn(userService, "getById");

  getById.mockResolvedValueOnce(null);
  expect(await service.authenticate("token")).toBeNull();

  getById.mockResolvedValueOnce({ ...employee, isActive: false });
  expect(await service.authenticate("token")).toBeNull();

  getById.mockResolvedValueOnce({ ...employee, isAgent: true });
  expect(await service.authenticate("token")).toBeNull();
});

it("resolves the active account behind a valid token and records its use", async () => {
  const { service, repository, userService } = await createService();
  const findUserId = vi
    .spyOn(repository, "findUserIdByTokenHash")
    .mockResolvedValue("user-1");
  vi.spyOn(userService, "getById").mockResolvedValue(employee);
  const markUsed = vi
    .spyOn(repository, "markUsed")
    .mockResolvedValue(undefined);

  expect(await service.authenticate("valid-token")).toEqual(employee);
  expect(findUserId).toHaveBeenCalledWith(hashOf("valid-token"));
  expect(markUsed).toHaveBeenCalledWith(hashOf("valid-token"));
});

it("records the use of a session at most once per minute", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { service, repository, userService } = await createService();
  vi.spyOn(repository, "findUserIdByTokenHash").mockResolvedValue("user-1");
  vi.spyOn(userService, "getById").mockResolvedValue(employee);
  const markUsed = vi
    .spyOn(repository, "markUsed")
    .mockResolvedValue(undefined);

  await service.authenticate("token");
  vi.setSystemTime(TOUCH_INTERVAL_MS - 1);
  await service.authenticate("token");
  expect(markUsed).toHaveBeenCalledTimes(1);

  vi.setSystemTime(TOUCH_INTERVAL_MS);
  await service.authenticate("token");
  expect(markUsed).toHaveBeenCalledTimes(2);
});

it("logs a failed use record and allows the next request to record it again", async () => {
  const { service, repository, userService } = await createService();
  vi.spyOn(repository, "findUserIdByTokenHash").mockResolvedValue("user-1");
  vi.spyOn(userService, "getById").mockResolvedValue(employee);
  const failure = new Error("database unavailable");
  const markUsed = vi
    .spyOn(repository, "markUsed")
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(undefined);

  expect(await service.authenticate("token")).toEqual(employee);
  await vi.waitFor(() => {
    expect(logCaughtError).toHaveBeenCalledWith("SessionService", failure);
  });

  expect(await service.authenticate("token")).toEqual(employee);
  expect(markUsed).toHaveBeenCalledTimes(2);
});

it("resolves the identifier of a session from its token", async () => {
  const { service, repository } = await createService();
  const findId = vi
    .spyOn(repository, "findIdByTokenHash")
    .mockResolvedValue("session-1");

  expect(await service.findSessionId("token")).toBe("session-1");
  expect(findId).toHaveBeenCalledWith(hashOf("token"));
});

it("lists sessions with their browser and operating system and the current one first", async () => {
  const { service, repository } = await createService();
  const listActive = vi
    .spyOn(repository, "listActiveByUserId")
    .mockResolvedValue([
      {
        id: "session-1",
        tokenHash: hashOf("current"),
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        createdAt: "2026-11-01T10:00:00.000Z",
        lastUsedAt: "2026-11-20T10:00:00.000Z",
        isCurrent: true,
      },
      {
        id: "session-2",
        tokenHash: hashOf("other"),
        userAgent: null,
        createdAt: "2026-11-02T10:00:00.000Z",
        lastUsedAt: "2026-11-03T10:00:00.000Z",
        isCurrent: false,
      },
    ]);

  expect(await service.getSessionSummaries("user-1", "current")).toEqual([
    {
      id: "session-1",
      browser: "Chrome 120",
      operatingSystem: "Windows",
      createdAt: "2026-11-01T10:00:00.000Z",
      lastUsedAt: "2026-11-20T10:00:00.000Z",
      isCurrent: true,
    },
    {
      id: "session-2",
      browser: null,
      operatingSystem: null,
      createdAt: "2026-11-02T10:00:00.000Z",
      lastUsedAt: "2026-11-03T10:00:00.000Z",
      isCurrent: false,
    },
  ]);
  expect(listActive).toHaveBeenCalledWith("user-1", hashOf("current"));
});

it("lists sessions with an empty current-token hash without a browser token", async () => {
  const { service, repository } = await createService();
  const listActive = vi
    .spyOn(repository, "listActiveByUserId")
    .mockResolvedValue([]);

  expect(await service.getSessionSummaries("user-1", null)).toEqual([]);
  expect(listActive).toHaveBeenCalledWith("user-1", "");
});

it("revokes another session of the user and reports success", async () => {
  const { service, repository } = await createService();
  vi.spyOn(repository, "findTokenHashByIdAndUserId").mockResolvedValue(
    hashOf("other"),
  );
  const remove = vi
    .spyOn(repository, "deleteByIdAndUserId")
    .mockResolvedValue(undefined);

  expect(
    await service.revokeSessionById("user-1", "session-2", "current"),
  ).toBe(true);
  expect(remove).toHaveBeenCalledWith("session-2", "user-1");
});

it("does not revoke an unknown session or the requesting browser's own session", async () => {
  const { service, repository } = await createService();
  const find = vi.spyOn(repository, "findTokenHashByIdAndUserId");
  const remove = vi
    .spyOn(repository, "deleteByIdAndUserId")
    .mockResolvedValue(undefined);

  find.mockResolvedValueOnce(null);
  expect(await service.revokeSessionById("user-1", "missing", "current")).toBe(
    false,
  );

  find.mockResolvedValueOnce(hashOf("current"));
  expect(await service.revokeSessionById("user-1", "own", "current")).toBe(
    false,
  );
  expect(remove).not.toHaveBeenCalled();
});

it("revokes a session without a requesting token when no browser token is given", async () => {
  const { service, repository } = await createService();
  vi.spyOn(repository, "findTokenHashByIdAndUserId").mockResolvedValue(
    hashOf("other"),
  );
  vi.spyOn(repository, "deleteByIdAndUserId").mockResolvedValue(undefined);

  expect(await service.revokeSessionById("user-1", "session-2", null)).toBe(
    true,
  );
});

it("keeps only the requesting browser's session when revoking the others", async () => {
  const { service, repository } = await createService();
  const deleteOthers = vi
    .spyOn(repository, "deleteAllExceptTokenHash")
    .mockResolvedValue(undefined);

  await service.revokeOtherSessions("user-1", "current");
  await service.revokeOtherSessions("user-1", null);

  expect(deleteOthers).toHaveBeenNthCalledWith(1, "user-1", hashOf("current"));
  expect(deleteOthers).toHaveBeenNthCalledWith(2, "user-1", "");
});

it("revokes every session of a user", async () => {
  const { service, repository } = await createService();
  const deleteAll = vi
    .spyOn(repository, "deleteAllByUserId")
    .mockResolvedValue(undefined);

  await service.revokeAllSessions("user-1");

  expect(deleteAll).toHaveBeenCalledWith("user-1");
});

it("revokes a browser session by its token hash and ignores a missing token", async () => {
  const { service, repository } = await createService();
  const deleteByHash = vi
    .spyOn(repository, "deleteByTokenHash")
    .mockResolvedValue(undefined);

  await service.revoke(null);
  await service.revoke("token");

  expect(deleteByHash).toHaveBeenCalledTimes(1);
  expect(deleteByHash).toHaveBeenCalledWith(hashOf("token"));
});

it("revokes an agent browser token through the wired agent sessions only", async () => {
  const { service } = await createService();
  await service.revoke("pabs_unwired");

  const agentBrowsers: Pick<AgentBrowserSessions, "authenticate" | "revoke"> = {
    authenticate: vi.fn().mockResolvedValue(null),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  service.setAgentBrowsers(agentBrowsers);
  await service.revoke("pabs_issued");

  expect(agentBrowsers.revoke).toHaveBeenCalledWith("pabs_issued");
});

it("removes expired sessions from the repository", async () => {
  const { service, repository } = await createService();
  const deleteExpired = vi
    .spyOn(repository, "deleteExpired")
    .mockResolvedValue(undefined);

  await service.removeExpiredSessions();

  expect(deleteExpired).toHaveBeenCalledTimes(1);
});
