import { beforeEach, expect, it, vi } from "vitest";

import { action } from "@/app/routes/chat-page-agent-control";
import { action as chatPageAction } from "@/app/routes/chat-page-server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  agentChatControlService: {
    overview: vi.fn(),
    setModel: vi.fn(),
    renew: vi.fn(),
    compact: vi.fn(),
  },
  agentChatCommandService: { run: vi.fn() },
  chatGroupMembershipService: {
    members: vi.fn(),
    saveControllers: vi.fn(),
    removeMember: vi.fn(),
    dissolve: vi.fn(),
  },
  agentEmployeeSessions: { send: vi.fn() },
  conversationService: { send: vi.fn() },
  chatGroupService: { find: vi.fn(), recordActivity: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function post(fields: Record<string, string>): Promise<Response> {
  const request = new Request(
    "http://pages.invalid/chat-page-api/agent-control",
    {
      method: "POST",
      body: new URLSearchParams(fields),
    },
  );
  return action(routeArguments(request, EMPLOYEE, {}));
}

it("sets the model of an agent in a group and answers with the choice (PAGE-380)", async () => {
  services.agentChatControlService.setModel.mockResolvedValue({
    agentId: "ed",
  });
  const response = await post({
    intent: "set-model",
    kind: "group",
    agentId: "ed",
    conversationId: "team",
    connectionId: "claude",
    model: "claude-opus-5-5",
    reasoningEffort: "high",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    overview: { agentId: "ed" },
  });
  expect(services.agentChatControlService.setModel).toHaveBeenCalledWith(
    EMPLOYEE,
    { kind: "group", agentId: "ed", conversationId: "team" },
    {
      connectionId: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    },
  );
});

it("resets, renews and compacts in the direct chat (PAGE-380)", async () => {
  await post({ intent: "reset-model", kind: "direct", agentId: "ed" });
  expect(services.agentChatControlService.setModel).toHaveBeenCalledWith(
    EMPLOYEE,
    { kind: "direct", agentId: "ed" },
    null,
  );
  await post({ intent: "new", kind: "direct", agentId: "ed" });
  await post({ intent: "compact", kind: "direct", agentId: "ed" });
  expect(services.agentChatControlService.renew).toHaveBeenCalledOnce();
  expect(services.agentChatControlService.compact).toHaveBeenCalledOnce();
});

it("maps a missing right to 403 and an unknown intent to 400 (PAGE-380)", async () => {
  services.chatGroupMembershipService.removeMember.mockRejectedValue(
    new AgentEmployeeError("forbidden"),
  );
  const refused = await post({
    intent: "remove-member",
    groupId: "team",
    memberId: "ed",
  });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ ok: false, error: "forbidden" });
  expect((await post({ intent: "agent-tool" })).status).toBe(400);
});

it("removes a member and dissolves a group for the owner (PAGE-380)", async () => {
  services.chatGroupMembershipService.members.mockResolvedValue({
    groupId: "team",
  });
  const removed = await post({
    intent: "remove-member",
    groupId: "team",
    memberId: "ed",
  });
  expect(await removed.json()).toEqual({
    ok: true,
    members: { groupId: "team" },
  });
  await post({ intent: "dissolve", groupId: "team" });
  expect(services.chatGroupMembershipService.dissolve).toHaveBeenCalledWith(
    EMPLOYEE,
    "team",
  );
});

it("runs a typed command of the chat page instead of sending it to an agent (PAGE-380)", async () => {
  services.agentChatCommandService.run.mockResolvedValue({
    status: "forbidden",
  });
  const request = new Request("http://pages.invalid/chat", {
    method: "POST",
    body: new URLSearchParams({
      intent: "send-group",
      groupId: "team",
      text: "/compact @ed",
      clientMessageId: "c1",
    }),
  });
  const result = await chatPageAction(routeArguments(request, EMPLOYEE, {}));
  expect(result.data).toEqual({
    ok: true,
    intent: "send-group",
    commandOutcome: { status: "forbidden" },
  });
  expect(services.agentChatCommandService.run).toHaveBeenCalledWith(
    EMPLOYEE,
    { kind: "group", conversationId: "team" },
    "/compact @ed",
  );
  // Nothing is stored, so no agent answers and no decision runs.
  expect(services.conversationService.send).not.toHaveBeenCalled();
  const direct = new Request("http://pages.invalid/chat", {
    method: "POST",
    body: new URLSearchParams({ intent: "send", agentId: "ed", text: "/new" }),
  });
  await chatPageAction(routeArguments(direct, EMPLOYEE, {}));
  expect(services.agentEmployeeSessions.send).not.toHaveBeenCalled();
  expect(services.agentChatCommandService.run).toHaveBeenLastCalledWith(
    EMPLOYEE,
    { kind: "direct", agentId: "ed" },
    "/new",
  );
});
