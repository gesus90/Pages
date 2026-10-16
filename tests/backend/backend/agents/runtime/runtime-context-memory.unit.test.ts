import { expect, it, vi } from "vitest";

import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import { createRuntimeMemory } from "@/backend/agents/runtime/RuntimeMemory";

import {
  runtimeActor,
  runtimeContext,
  runtimeSessionId,
} from "./runtime-fixture";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatContextService } from "@/backend/service/chat/ChatContextService";

it("validates actor, session and run before creating a server context", async () => {
  const { sessions, controller } = await runtimeContext();
  const input = {
    actor: runtimeActor,
    sessionId: runtimeSessionId,
    runId: "run",
    signal: controller.signal,
  };
  await expect(
    createRuntimeExecutionContext({ ...input, sessionId: "invalid" }, sessions),
  ).rejects.toThrow();
  await expect(
    createRuntimeExecutionContext({ ...input, runId: " " }, sessions),
  ).rejects.toThrow("run ID");
  await expect(
    createRuntimeExecutionContext(
      { ...input, actor: { ...runtimeActor, isActive: false } },
      sessions,
    ),
  ).rejects.toThrow();
  await expect(
    createRuntimeExecutionContext(
      { ...input, actor: { ...runtimeActor, mustChangePassword: true } },
      sessions,
    ),
  ).rejects.toThrow();
  sessions.require.mockRejectedValueOnce(new Error("Foreign session"));
  await expect(createRuntimeExecutionContext(input, sessions)).rejects.toThrow(
    "Foreign session",
  );
});

it("freezes the identity snapshot and rechecks access and cancellation", async () => {
  const { sessions, controller } = await runtimeContext();
  const actor = { ...runtimeActor };
  const context = await createRuntimeExecutionContext(
    {
      actor,
      sessionId: runtimeSessionId,
      runId: "run",
      signal: controller.signal,
    },
    sessions,
  );
  Object.assign(actor, { id: "foreign" });
  await context.authorize();
  expect(Object.isFrozen(context)).toBe(true);
  expect(context.userId).toBe(runtimeActor.id);
  expect(sessions.require.mock.lastCall?.[0].id).toBe(runtimeActor.id);
  const checks = sessions.require.mock.calls.length;
  controller.abort();
  await expect(context.authorize()).rejects.toThrow();
  expect(sessions.require).toHaveBeenCalledTimes(checks);
});

it("checks cancellation that arrives while session authorization is pending", async () => {
  const { context, sessions, controller } = await runtimeContext();
  sessions.require.mockImplementationOnce(async () => {
    controller.abort();
    return {
      id: runtimeSessionId,
      createdAt: "",
      lastMessageAt: "",
      preview: "",
    };
  });
  await expect(context.authorize()).rejects.toThrow();
});

it("delegates persisted history and appends exclusively within the bound owner session", async () => {
  const { context, sessions } = await runtimeContext();
  const history = {
    history: vi.fn<ChatContextService["history"]>(async () => ({
      summary: "Existing summary",
      messages: [],
    })),
  };
  const messages = {
    append: vi.fn<ChatSessionRepository["append"]>(
      async (userId, sessionId, message) => ({
        id: `${userId}-${sessionId}`,
        createdAt: "",
        ...message,
      }),
    ),
  };
  const memory = createRuntimeMemory(context, runtimeActor, {
    history,
    messages,
  });
  expect(await memory.history()).toEqual({
    summary: "Existing summary",
    messages: [],
  });
  expect(history.history).toHaveBeenCalledWith(runtimeActor, runtimeSessionId);
  const message = { role: "assistant" as const, content: "Visible answer" };
  await memory.append(message);
  expect(messages.append).toHaveBeenCalledWith(
    context.userId,
    context.sessionId,
    message,
  );
  expect(sessions.require).toHaveBeenCalledTimes(3);
  expect(() =>
    createRuntimeMemory(
      context,
      { ...runtimeActor, id: "foreign" },
      { history, messages },
    ),
  ).toThrow("does not match");
  sessions.require.mockRejectedValue(new Error("Session deleted"));
  await expect(memory.history()).rejects.toThrow("Session deleted");
  await expect(memory.append(message)).rejects.toThrow("Session deleted");
  expect(history.history).toHaveBeenCalledOnce();
  expect(messages.append).toHaveBeenCalledOnce();
});
