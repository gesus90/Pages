import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type {
  ChatContextHistory,
  ChatContextService,
} from "@/backend/service/chat/ChatContextService";
import type { ChatMessage } from "@/definition/Chat";
import type {
  RuntimeContextInput,
  RuntimeExecutionContext,
} from "./RuntimeExecutionContext";

/** Existing Pages boundaries; no Mastra storage tables or duplicate compaction. */
export interface RuntimeMemoryDependencies {
  readonly history: Pick<ChatContextService, "history">;
  readonly messages: Pick<ChatSessionRepository, "append">;
}

/** Explicit transcript port; the caller chooses when to persist a human-visible message. */
export interface RuntimeMemory {
  readonly history: () => Promise<ChatContextHistory>;
  readonly append: (
    message: Pick<ChatMessage, "role" | "content">,
  ) => Promise<void>;
}

/** Delegates to the existing authorized history service and owner-scoped repository. */
export function createRuntimeMemory(
  context: RuntimeExecutionContext,
  actor: RuntimeContextInput["actor"],
  dependencies: RuntimeMemoryDependencies,
): RuntimeMemory {
  if (actor.id !== context.userId)
    throw new Error("Runtime memory actor does not match its context");
  const owner = Object.freeze({ ...actor });
  return Object.freeze({
    history: async () => {
      await context.authorize();
      return dependencies.history.history(owner, context.sessionId);
    },
    append: async (message: Pick<ChatMessage, "role" | "content">) => {
      await context.authorize();
      await dependencies.messages.append(
        context.userId,
        context.sessionId,
        message,
      );
    },
  });
}
