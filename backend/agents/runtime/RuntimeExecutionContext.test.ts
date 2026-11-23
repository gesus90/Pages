import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

import type { User } from "@/definition/User";

const SESSION_ID = "alpha-bravo-charlie-delta-echo";

const actor: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function sessions(): { require: Mock<() => Promise<void>> } {
  return { require: vi.fn(() => Promise.resolve()) };
}

describe("createRuntimeExecutionContext", () => {
  it("binds the verified session into a frozen context", async () => {
    const service = sessions();
    const controller = new AbortController();
    const context = await createRuntimeExecutionContext(
      {
        actor,
        sessionId: SESSION_ID,
        runId: "run-1",
        signal: controller.signal,
      },
      service as never,
    );
    expect(context).toMatchObject({
      userId: "user-1",
      sessionId: SESSION_ID,
      runId: "run-1",
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(service.require).toHaveBeenCalledOnce();
    await context.authorize();
    expect(service.require).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty run ID", async () => {
    await expect(
      createRuntimeExecutionContext(
        {
          actor,
          sessionId: SESSION_ID,
          runId: "  ",
          signal: new AbortController().signal,
        },
        sessions() as never,
      ),
    ).rejects.toThrow("run ID");
  });

  it("rejects an invalid session ID, an inactive actor and a missing session", async () => {
    const signal = new AbortController().signal;
    const create = (
      input: { actor: User; sessionId: string },
      service = sessions(),
    ): Promise<unknown> =>
      createRuntimeExecutionContext(
        { ...input, runId: "run", signal },
        service as never,
      );
    await expect(create({ actor, sessionId: "x" })).rejects.toThrow();
    await expect(
      create({ actor: { ...actor, isActive: false }, sessionId: SESSION_ID }),
    ).rejects.toThrow();
    const missing = sessions();
    missing.require.mockRejectedValue(new Error("gone"));
    await expect(
      create({ actor, sessionId: SESSION_ID }, missing),
    ).rejects.toThrow("gone");
  });

  it("stops before and after authorization when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createRuntimeExecutionContext(
        {
          actor,
          sessionId: SESSION_ID,
          runId: "run",
          signal: controller.signal,
        },
        sessions() as never,
      ),
    ).rejects.toThrow();
    const late = new AbortController();
    const service = sessions();
    service.require.mockImplementation(async () => {
      late.abort();
      await Promise.resolve();
    });
    await expect(
      createRuntimeExecutionContext(
        { actor, sessionId: SESSION_ID, runId: "run", signal: late.signal },
        service as never,
      ),
    ).rejects.toThrow();
  });
});
