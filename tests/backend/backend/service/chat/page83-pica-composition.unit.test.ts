import { expect, it, vi } from "vitest";

import { createChatServices } from "@/app/lib/chat-services.server";
import { Database } from "@/backend/database/Database";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { PicaApiModels } from "@/backend/agents/providers/PicaApiModels";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { readPicaInstructions } from "@/backend/service/chat/PicaInstructionFiles";

import { bareInstance } from "../tasks/bare-instance";
import { ASSIGNMENT, FIRST, OWNER, SESSION } from "./page48-chat-fixture";
import { picaToolCalls, picaWorld } from "./page83-pica-fixture";
import { responseChunks } from "../../agents/runtime/runtime-fixture";

import type { MockInstance } from "vitest";

vi.mock("@/backend/service/chat/PicaInstructionFiles", () => ({
  readPicaInstructions: vi.fn(async () => ({ soul: "Soul", agents: "Rules" })),
}));

/** Production composition on fake repositories; even an unexpected database call cannot open DuckDB. */
function composition(cli = false): {
  readonly services: ReturnType<typeof createChatServices>;
  readonly textRun: ReturnType<typeof vi.fn>;
  readonly native: ReturnType<typeof picaWorld>;
  readonly append: MockInstance<ChatSessionRepository["append"]>;
} {
  vi.spyOn(Database.prototype, "query").mockRejectedValue(
    new Error("Unexpected database query"),
  );
  vi.spyOn(ChatSessionRepository.prototype, "find").mockResolvedValue(SESSION);
  vi.spyOn(ChatSessionRepository.prototype, "messages").mockResolvedValue(
    Array.from({ length: 10 }, (_, index) => ({
      id: `stored-${index}`,
      role: "user",
      content: "Synthetic older context ".repeat(100),
      createdAt: "today",
    })),
  );
  const append = vi
    .spyOn(ChatSessionRepository.prototype, "append")
    .mockImplementation(async (_, sessionId, message) => ({
      ...message,
      id: sessionId,
      createdAt: "today",
    }));
  vi.spyOn(ChatContextRepository.prototype, "read").mockResolvedValue({
    summary: null,
    throughId: null,
    revision: 0,
  });
  vi.spyOn(ChatAttachmentRepository.prototype, "list").mockResolvedValue([]);
  vi.spyOn(ChatSettingsRepository.prototype, "read").mockResolvedValue({
    systemInstruction: null,
    attachmentLimitBytes: 1024,
  });
  vi.spyOn(UserSettingsRepository.prototype, "findByUserId").mockResolvedValue(
    null,
  );
  const native = picaWorld((_, step) =>
    step === 0
      ? picaToolCalls([{ tool: "tickets_read", input: { ticketId: "PAGE-1" } }])
      : responseChunks("Antwort"),
  );
  const models = bareInstance(PicaApiModels.prototype);
  vi.spyOn(models, "use").mockImplementation(native.models.use);
  vi.spyOn(models, "authorize").mockImplementation(native.models.authorize);
  const router = bareInstance(AgentOperationRouter.prototype);
  vi.spyOn(router, "handle").mockImplementation(native.router);
  const textRun = vi.fn(async () => "Legacy text execution must not run");
  const services = createChatServices({
    database: bareInstance(Database.prototype),
    directory: "/synthetic-pages",
    accounts: {
      users: { getById: async () => OWNER },
      administration: {
        getContext: async () => ({
          userId: OWNER.id,
          role: null,
          isAdmin: true,
          mode: "admin",
          firstName: "Owner",
          lastName: "",
          isActive: true,
          departments: [],
          managedDepartments: [],
          allDepartments: true,
          allProjects: true,
          hasHadDepartment: false,
        }),
      },
    },
    agents: {
      agentProfileService: {
        resolve: async () => ({
          ...ASSIGNMENT,
          connection: {
            ...ASSIGNMENT.connection,
            provider: cli ? "codex_cli" : "openai",
          },
        }),
      },
      agentChatExecution: { run: textRun },
      picaApiModels: models,
      chatRequests: new ChatRequestRegistry(),
    },
    router,
  });
  return { services, textRun, native, append };
}

it("selects the native API runtime in production composition without invoking the old action execution", async () => {
  const world = composition();
  const reply = await world.services.chatService.send(OWNER, {
    requestId: "production",
    sessionId: FIRST,
    text: "Lies PAGE-1",
  });
  expect(reply.answer.content).toBe("Antwort");
  expect(world.native.router).toHaveBeenCalledOnce();
  expect(world.textRun).not.toHaveBeenCalled();
  expect(world.append).toHaveBeenCalledTimes(2);
  expect(readPicaInstructions).toHaveBeenCalledOnce();
});

it("rejects ACP for sends and explicit compaction in production before any execution or message storage", async () => {
  const world = composition(true);
  await expect(
    world.services.chatService.send(OWNER, {
      requestId: "production-acp",
      sessionId: FIRST,
      text: "Hallo",
    }),
  ).rejects.toMatchObject({ code: "apiModeRequired" });
  await expect(
    world.services.chatContextService.compact(OWNER, FIRST),
  ).rejects.toMatchObject({ code: "apiModeRequired" });
  expect(world.textRun).not.toHaveBeenCalled();
  expect(world.native.provider.calls).not.toHaveBeenCalled();
  expect(world.append).not.toHaveBeenCalled();
});
