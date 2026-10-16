import {
  readChatSessionId,
  requireChatActor,
} from "@/backend/service/chat/ChatSessionService";

import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { User } from "@/definition/User";

/** Server-owned identity and cancellation scope for one agent invocation. */
export interface RuntimeExecutionContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  /** Rechecks session ownership before model, tool or memory access. */
  readonly authorize: () => Promise<void>;
}

/** Values resolved by the server, never from model arguments or request context. */
export interface RuntimeContextInput {
  readonly actor: User;
  readonly sessionId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
}

/** Binds a verified Pages session to an immutable, invocation-scoped context. */
export async function createRuntimeExecutionContext(
  input: RuntimeContextInput,
  sessions: Pick<ChatSessionService, "require">,
): Promise<RuntimeExecutionContext> {
  const actor = Object.freeze({ ...input.actor });
  const sessionId = readChatSessionId(input.sessionId);
  const { runId, signal } = input;
  if (!runId.trim()) throw new Error("An agent runtime requires a run ID");
  const authorize = async (): Promise<void> => {
    signal.throwIfAborted();
    requireChatActor(actor);
    await sessions.require(actor, sessionId);
    signal.throwIfAborted();
  };
  await authorize();
  return Object.freeze({
    userId: actor.id,
    sessionId,
    runId,
    signal,
    authorize,
  });
}
