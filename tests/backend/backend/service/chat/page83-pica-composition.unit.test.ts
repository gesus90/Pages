import { expect, it, vi } from "vitest";

import { createChatServices } from "@/app/lib/chat-services.server";
import { Database } from "@/backend/database/Database";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { readPicaInstructions } from "@/backend/service/chat/PicaInstructionFiles";

import { bareInstance } from "../tasks/bare-instance";
import { ASSIGNMENT, FIRST, OWNER, SESSION } from "./page48-chat-fixture";

import type { MockInstance } from "vitest";

// The independent MCP catalog is mocked at the Pages boundary.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

vi.mock("@/backend/service/chat/PicaInstructionFiles", () => ({
  readPicaInstructions: vi.fn(async () => ({ soul: "Soul", agents: "Rules" })),
}));

/** Production composition on fake repositories; even an unexpected database call cannot open DuckDB. */
function composition(cli = false): {
  readonly services: ReturnType<typeof createChatServices>;
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
  const router = bareInstance(AgentOperationRouter.prototype);
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
      chatRequests: new ChatRequestRegistry(),
    },
    router,
  });
  return { services, append };
}

it("refuses a production message without the ACP service instead of invoking text execution", async () => {
  const world = composition();
  await expect(
    world.services.chatService.submit(OWNER, {
      requestId: "production",
      sessionId: FIRST,
      text: "Lies PAGE-1",
    }),
  ).rejects.toMatchObject({ code: "acpProviderUnsupported" });
  expect(world.append).not.toHaveBeenCalled();
  expect(readPicaInstructions).not.toHaveBeenCalled();
});

it("leaves native compaction to the CLI and never runs a direct API model", async () => {
  const world = composition(true);
  await expect(
    world.services.chatContextService.compact(OWNER, FIRST),
  ).rejects.toMatchObject({ code: "nativeContextManaged" });
  expect(world.append).not.toHaveBeenCalled();
});
