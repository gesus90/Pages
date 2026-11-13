import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/chat-page-server";
import { ConversationError } from "@/backend/error/ConversationError";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  chatDirectoryService: {
    directory: vi.fn(),
    saveContacts: vi.fn(),
    olderMessages: vi.fn(),
  },
  conversationLinks: { embedDomains: vi.fn(), setReleased: vi.fn() },
  chatViewPreferences: {
    read: vi.fn(),
    setCardState: vi.fn(),
    setSplitWidth: vi.fn(),
    setListCollapsed: vi.fn(),
  },
  conversationService: {
    setMuted: vi.fn(),
    markRead: vi.fn(),
    deleteMessage: vi.fn(),
  },
  agentEmployeeSessions: { stop: vi.fn(), cancelTool: vi.fn() },
  conversationAgentReplies: { stop: vi.fn() },
  conversationAgentGuard: { resume: vi.fn() },
  conversationReplySettingsService: { read: vi.fn(), save: vi.fn() },
  agentChatPrivacyService: { setConfidential: vi.fn() },
  conversationVoiceMaximumMs: 1200,
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => vi.resetAllMocks());

function change(
  fields: Record<string, string>,
): Promise<Awaited<ReturnType<typeof action>>> {
  const request = new Request("http://pages.invalid/chat", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return action(routeArguments(request, EMPLOYEE, {}));
}

it("loads domains for group and direct conversations with the user's preferences", async () => {
  services.chatDirectoryService.directory.mockResolvedValue({
    groups: [{ id: "group" }],
    participants: [{ conversationId: "direct" }, { conversationId: null }],
  });
  services.conversationLinks.embedDomains.mockResolvedValue(["example.org"]);
  services.chatViewPreferences.read.mockResolvedValue({ width: 300 });
  const result = await loader(
    routeArguments(new Request("http://pages.invalid/chat"), EMPLOYEE, {}),
  );
  expect(services.conversationLinks.embedDomains).toHaveBeenCalledWith([
    "group",
    "direct",
  ]);
  expect(result).toMatchObject({
    embedDomains: ["example.org"],
    viewPreferences: { width: 300 },
    voiceMaximumMs: 1200,
  });
});

it("rejects an unauthenticated loader and an unknown action", async () => {
  await expect(
    loader(routeArguments(new Request("http://pages.invalid/chat"), null, {})),
  ).rejects.toMatchObject({ status: 403 });
  await expect(change({ intent: "unknown" })).rejects.toMatchObject({
    status: 400,
  });
});

it("validates mute input and maps conversation errors", async () => {
  const invalid = await change({ intent: "mute", isMuted: "yes" });
  expect(invalid.init?.status).toBe(400);
  expect(invalid.data).toEqual({
    ok: false,
    intent: "mute",
    error: "invalidInput",
  });
  expect(services.conversationService.setMuted).not.toHaveBeenCalled();
  services.conversationService.setMuted.mockRejectedValue(
    new ConversationError("not_found"),
  );
  const missing = await change({
    intent: "mute",
    conversationId: "c",
    isMuted: "true",
  });
  expect(services.conversationService.setMuted).toHaveBeenCalledWith(EMPLOYEE, {
    conversationId: "c",
    isMuted: true,
  });
  expect(missing.init?.status).toBe(404);
  expect(missing.data).toEqual({
    ok: false,
    intent: "mute",
    error: "invalidInput",
  });
});

it("passes reply settings and converts an empty default responder to null", async () => {
  services.conversationReplySettingsService.save.mockResolvedValue({
    mode: "all",
  });
  const result = await change({
    intent: "save-reply-settings",
    conversationId: "c",
    mode: "all",
    maximumResponders: "2",
  });
  expect(services.conversationReplySettingsService.save).toHaveBeenCalledWith(
    EMPLOYEE,
    {
      conversationId: "c",
      mode: "all",
      defaultResponderId: null,
      maximumResponders: 2,
    },
  );
  expect(result.data).toEqual({
    ok: true,
    intent: "save-reply-settings",
    replySettings: { mode: "all" },
  });
});

it("parses contacts and forwards content and agent controls", async () => {
  await change({ intent: "save-contacts", contacts: '["a"]' });
  await change({
    intent: "embed-domain",
    conversationId: "c",
    domain: "example.org",
    isReleased: "true",
  });
  await change({ intent: "stop-group", groupId: "g", agentId: "a" });
  expect(services.chatDirectoryService.saveContacts).toHaveBeenCalledWith(
    EMPLOYEE,
    ["a"],
  );
  expect(services.conversationLinks.setReleased).toHaveBeenCalledWith(
    EMPLOYEE,
    { conversationId: "c", domain: "example.org", isReleased: true },
  );
  expect(services.conversationAgentReplies.stop).toHaveBeenCalledWith(
    EMPLOYEE,
    "g",
    "a",
  );
});

it("stores whether the person collapsed the list of the chat page (PAGE-325)", async () => {
  const stored = await change({
    intent: "list-collapsed",
    isCollapsed: "true",
  });
  expect(services.chatViewPreferences.setListCollapsed).toHaveBeenCalledWith(
    EMPLOYEE,
    "true",
  );
  expect(stored.init?.status ?? 200).toBe(200);

  services.chatViewPreferences.setListCollapsed.mockRejectedValue(
    new ConversationError("invalid"),
  );
  const refused = await change({ intent: "list-collapsed", isCollapsed: "1" });
  expect(refused.init?.status).toBe(400);
});
