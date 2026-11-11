import { beforeEach, expect, it, vi } from "vitest";

import { AgentChatSessionOperationService } from "@/backend/service/agents/AgentChatSessionOperationService";
import { ChatError } from "@/backend/error/ChatErrors";

import type { ChatErrorCode } from "@/backend/error/ChatErrors";
import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const IDENTITY: AgentIdentity = {
  userId: "user-1",
  isAdmin: false,
  permissions: [],
};
const ACTOR = { id: "user-1", isActive: true, mustChangePassword: false };
const FIRST = "apfel-birne-kirsche-pflaume-traube";

const list = vi.fn();
const removeSelected = vi.fn();
const getById = vi.fn();

function service(): AgentChatSessionOperationService {
  return new AgentChatSessionOperationService({
    sessions: { list, removeSelected },
    users: { getById },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getById.mockResolvedValue(ACTOR);
});

it("leaves every other operation to the next handler without reading the account", async () => {
  expect(await service().handle(IDENTITY, "chat.other", {})).toBeNull();
  expect(await service().handle(IDENTITY, 42, {})).toBeNull();
  expect(getById).not.toHaveBeenCalled();
});

it.each([
  ["unknown account", null],
  ["inactive account", { ...ACTOR, isActive: false }],
  [
    "account that must change its password",
    { ...ACTOR, mustChangePassword: true },
  ],
])("refuses an %s before touching sessions", async (label, actor) => {
  getById.mockResolvedValue(actor);
  await expect(
    service().handle(IDENTITY, "chat.sessions.list", undefined),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(list).not.toHaveBeenCalled();
});

it("lists the own sessions with their total", async () => {
  list.mockResolvedValue([{ id: FIRST }, { id: "second" }]);
  expect(
    await service().handle(IDENTITY, "chat.sessions.list", undefined),
  ).toEqual({
    apiVersion: "1",
    result: { sessions: [{ id: FIRST }, { id: "second" }], total: 2 },
  });
  expect(list).toHaveBeenCalledExactlyOnceWith(ACTOR);
});

it.each([
  ["a primitive", "text"],
  ["null", null],
  ["an array", []],
  ["a parameter the listing does not know", { sessionIds: [FIRST] }],
])("refuses %s as list input", async (label, input) => {
  await expect(
    service().handle(IDENTITY, "chat.sessions.list", input),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(list).not.toHaveBeenCalled();
});

it("refuses a deletion parameter that is not part of the contract", async () => {
  await expect(
    service().handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST],
      expectedCount: 1,
      confirmation: "LÖSCHEN",
      force: true,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(removeSelected).not.toHaveBeenCalled();
});

it.each([
  undefined,
  {},
  { confirmation: "DELETE" },
  { confirmation: "löschen" },
])("requires the exact word LÖSCHEN before deleting: %j", async (input) => {
  await expect(
    service().handle(IDENTITY, "chat.sessions.delete", input),
  ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(removeSelected).not.toHaveBeenCalled();
});

it("deletes the counted selection and returns the outcome", async () => {
  const outcome = { deleted: [FIRST], failed: [], cleanupFailed: [] };
  removeSelected.mockResolvedValue(outcome);
  expect(
    await service().handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST],
      expectedCount: 1,
      confirmation: "LÖSCHEN",
    }),
  ).toEqual({ apiVersion: "1", result: outcome });
  expect(removeSelected).toHaveBeenCalledExactlyOnceWith(ACTOR, [FIRST]);
});

it.each([
  ["no ids", { sessionIds: [], expectedCount: 0 }],
  ["a non-array selection", { sessionIds: FIRST, expectedCount: 1 }],
])("refuses %s as an invalid selection", async (label, parameters) => {
  await expect(
    service().handle(IDENTITY, "chat.sessions.delete", {
      ...parameters,
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(removeSelected).not.toHaveBeenCalled();
});

it("refuses a count that differs from the selected ids", async () => {
  await expect(
    service().handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST],
      expectedCount: 2,
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(removeSelected).not.toHaveBeenCalled();
});

it.each<[ChatErrorCode, string]>([
  ["sessionMissing", "NOT_FOUND"],
  ["accessDenied", "INVALID_REQUEST"],
])("translates the chat failure %s into %s", async (chatCode, code) => {
  removeSelected.mockRejectedValue(new ChatError(chatCode));
  await expect(
    service().handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST],
      expectedCount: 1,
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code });
});

it("passes a failure that is no chat error through unchanged", async () => {
  const failure = new Error("storage offline");
  list.mockRejectedValue(failure);
  await expect(
    service().handle(IDENTITY, "chat.sessions.list", undefined),
  ).rejects.toBe(failure);
});
