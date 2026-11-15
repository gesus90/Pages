import { beforeEach, expect, it, vi } from "vitest";

import { action as chatPageAction } from "@/app/routes/chat-page-server";
import { loader } from "@/app/routes/chat-preview-frame";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { toVirtualMessage } from "@/backend/service/employee/ChatConversationView";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ConversationMessage } from "@/definition/Conversation";

const services = vi.hoisted(() => ({
  agentChatCommandService: { run: vi.fn() },
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

it("serves the preview frame with its own open network policy, sandboxed and framed only by Pages (PAGE-383)", async () => {
  const response = loader();
  const policy = response.headers.get("Content-Security-Policy") ?? "";
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(policy).toContain(
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  );
  expect(policy).toContain("frame-ancestors 'self'");
  expect(policy).toContain("sandbox allow-scripts allow-forms allow-modals");
  // No own origin, no navigation of Pages, no new windows.
  expect(policy).not.toContain("allow-same-origin");
  expect(policy).not.toContain("allow-top-navigation");
  expect(policy).not.toContain("allow-popups");
  const document = await response.text();
  expect(document).toContain("event.source !== parent");
  expect(document).toContain("pages-preview:render");
  expect(document).toContain(
    'parent.postMessage({ type: "pages-preview:ready" }, "*")',
  );
});

it("stores a message from a preview as a message of the person, never as a command (PAGE-383)", async () => {
  const request = new Request("http://pages.invalid/chat", {
    method: "POST",
    body: new URLSearchParams({
      intent: "send-group",
      groupId: "team",
      text: "/new @ed",
      clientMessageId: "preview-1",
    }),
  });
  await chatPageAction(routeArguments(request, EMPLOYEE, {}));
  expect(services.agentChatCommandService.run).not.toHaveBeenCalled();
  expect(services.conversationService.send).toHaveBeenCalledWith(
    EMPLOYEE,
    {
      conversationId: "team",
      clientMessageId: "preview-1",
      text: "/new @ed",
      attachmentIds: undefined,
    },
    {},
  );
});

const stored: ConversationMessage = {
  id: "m1",
  conversationId: "team",
  clientMessageId: "preview-abc",
  sender: { id: EMPLOYEE.id, kind: "human", name: "Ada", color: null },
  text: "Variante B nehmen",
  createdAt: "2026-11-14T10:00:00.000Z",
  mentions: [],
  attachments: [],
  links: [],
};

it("marks a stored message sent from a preview for every member, and no other (PAGE-383)", () => {
  expect(toVirtualMessage(stored, EMPLOYEE).isFromPreview).toBe(true);
  const other = { ...EMPLOYEE, id: "someone-else" };
  expect(toVirtualMessage(stored, other).isFromPreview).toBe(true);
  expect(
    toVirtualMessage({ ...stored, clientMessageId: "c1" }, EMPLOYEE)
      .isFromPreview,
  ).toBeUndefined();
});

it("reads the preview mark of a direct chat message with an agent from its client message ID (PAGE-383)", async () => {
  const rows: DatabaseValue[][] = [
    ["m1", "user", "Variante B", "today", null, "preview-xyz"],
    ["m2", "user", "Hallo", "today", null, "browser-1"],
  ];
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  const execute = vi.fn(async () => undefined);
  const repository = new ChatSessionRepository({
    query,
    execute,
    transaction: async <Result>(
      work: (connection: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work({ query, execute }),
  });
  const messages = await repository.messages("session");
  expect(messages[0]).toEqual({
    id: "m1",
    role: "user",
    content: "Variante B",
    createdAt: "today",
    isFromPreview: true,
  });
  expect(messages[1]?.isFromPreview).toBeUndefined();
  expect(query.mock.calls[0]?.[0]).toContain("client_message_id");
});
