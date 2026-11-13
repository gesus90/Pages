import { beforeEach, expect, it, vi } from "vitest";

import { McpConversationApi } from "@/backend/service/mcp/conversation/McpConversationApi";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import type { ConversationReplySettingsView } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";

const account: User = {
  id: "manager",
  username: "manager",
  displayName: "Manager",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function view(
  overrides: Partial<ConversationReplySettingsView> = {},
): ConversationReplySettingsView {
  return {
    conversationId: "group",
    mode: "decision",
    rules: CONVERSATION_DEFAULT_DECISION_RULES,
    defaults: CONVERSATION_DEFAULT_DECISION_RULES,
    isDefault: true,
    canManage: true,
    decisionModel: { status: "ready", name: "Decider" },
    hint: null,
    ...overrides,
  };
}

const settings = { read: vi.fn(), save: vi.fn() };
const api = new McpConversationApi(settings, {
  devices: { authenticate: vi.fn() },
  accounts: { findCredentialsByUsername: vi.fn() },
});

beforeEach(() => {
  vi.resetAllMocks();
  settings.read.mockResolvedValue(view());
  settings.save.mockResolvedValue(view());
});

it("keeps what the group has when the body names nothing", async () => {
  await api.set(account, "group", {});
  expect(settings.save).toHaveBeenCalledWith(account, {
    conversationId: "group",
    mode: "decision",
    rules: null,
  });
  settings.read.mockResolvedValue(
    view({
      mode: "mentions",
      isDefault: false,
      rules: { ...CONVERSATION_DEFAULT_DECISION_RULES, answerThreshold: 80 },
    }),
  );
  await api.set(account, "group", {});
  expect(settings.save).toHaveBeenLastCalledWith(account, {
    conversationId: "group",
    mode: "mentions",
    rules: { ...CONVERSATION_DEFAULT_DECISION_RULES, answerThreshold: 80 },
  });
});

it("changes the named values and keeps the others", async () => {
  await api.set(account, "group", {
    mode: "mentions",
    answerThreshold: 75,
    maximumResponders: 1,
  });
  expect(settings.save).toHaveBeenCalledWith(account, {
    conversationId: "group",
    mode: "mentions",
    rules: {
      answerThreshold: 75,
      responsibilityThreshold: 50,
      secondThreshold: 40,
      maximumResponders: 1,
    },
  });
});

it("returns the group to the defaults of the instance with useDefaults", async () => {
  settings.read.mockResolvedValue(
    view({
      isDefault: false,
      rules: { ...CONVERSATION_DEFAULT_DECISION_RULES, secondThreshold: 10 },
    }),
  );
  await api.set(account, "group", { useDefaults: true, answerThreshold: 99 });
  expect(settings.save).toHaveBeenCalledWith(account, {
    conversationId: "group",
    mode: "decision",
    rules: null,
  });
});

it("reads the settings of a group", async () => {
  await expect(api.read(account, "group")).resolves.toEqual(view());
  expect(settings.read).toHaveBeenCalledWith(account, "group");
});
