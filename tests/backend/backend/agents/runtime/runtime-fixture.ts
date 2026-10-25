import { vi } from "vitest";

import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { User } from "@/definition/User";

export const runtimeActor: User = {
  id: "runtime-owner",
  username: "runtime-owner",
  displayName: "Runtime Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
export const runtimeSessionId = "one-two-three-four-five";

/** Creates a server context at mocked ownership boundaries, without a database. */
export async function runtimeContext(): Promise<{
  readonly context: RuntimeExecutionContext;
  readonly controller: AbortController;
  readonly sessions: {
    readonly require: ReturnType<typeof vi.fn<ChatSessionService["require"]>>;
  };
}> {
  const controller = new AbortController();
  const sessions = {
    require: vi.fn<ChatSessionService["require"]>(async () => ({
      id: runtimeSessionId,
      createdAt: "2026-10-16T00:00:00Z",
      lastMessageAt: "2026-10-16T00:00:00Z",
      preview: "",
    })),
  };
  const context = await createRuntimeExecutionContext(
    {
      actor: runtimeActor,
      sessionId: runtimeSessionId,
      runId: "runtime-run",
      signal: controller.signal,
    },
    sessions,
  );
  return { context, controller, sessions };
}
