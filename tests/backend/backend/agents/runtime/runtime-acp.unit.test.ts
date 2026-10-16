import { expect, it, vi } from "vitest";

import { createRuntimeAcpModel } from "@/backend/agents/runtime/RuntimeAcpModel";
import { runRuntimeAcpTurn } from "@/backend/agents/runtime/RuntimeAcpSession";
import { createRuntimeAgent } from "@/backend/agents/runtime/RuntimeAgent";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";

import {
  closed,
  completedTurn,
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "../../service/agents/page81-resource-fixture";
import { fakeRuntimeModel, runtimeContext } from "./runtime-fixture";

import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { RuntimeAcpStart } from "@/backend/agents/runtime/RuntimeAcpSession";
import type { ModelRequest } from "./runtime-fixture";

it("runs ACP-backed Mastra generate and stream through durable shared scheduler leases", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const { context } = await runtimeContext();
  const sessions: PlanSession[] = [];
  const start = vi.fn(async (request: RuntimeAcpStart) => {
    expect(world.records.get(request.instanceId)).toMatchObject({
      state: "starting",
      userId: context.userId,
      runId: context.runId,
      provider: "codex_cli",
    });
    expect(request.context).toBe(context);
    expect(JSON.parse(request.prompt)).toMatchObject({
      messages: [
        { role: "system", content: "Bound instructions" },
        { role: "user", content: "Question" },
      ],
    });
    const native = nativeSession();
    sessions.push(native);
    return native;
  });
  const model = createRuntimeAcpModel({
    context,
    scheduler: world.scheduler,
    provider: "codex_cli",
    modelId: "native-model",
    start,
  });
  const agent = createRuntimeAgent({
    id: "acp",
    name: "ACP",
    instructions: "Bound instructions",
    model,
    context,
  });
  try {
    const answer = await agent.generate("Question");
    expect(answer.text).toBe("result");
    const output = await agent.stream("Question");
    let text = "";
    for await (const chunk of output.textStream) text += chunk;
    expect(text).toBe("result");
    expect(start).toHaveBeenCalledTimes(2);
    for (const native of sessions) expect(native.close).toHaveBeenCalledOnce();
    expect(world.store.remove).toHaveBeenCalledTimes(2);
    expect(world.scheduler.snapshot().active).toEqual([]);
  } finally {
    await world.scheduler.shutdown();
  }
});

it("keeps ACP queued without a native start while an API model can complete", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const blocker = await world.scheduler.open(
    owner("occupied"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const { context } = await runtimeContext();
  const start = vi.fn(async () => nativeSession());
  const pending = runRuntimeAcpTurn(
    { context, scheduler: world.scheduler, provider: "claude_code", start },
    "native task",
  );
  try {
    await vi.waitFor(() =>
      expect(world.scheduler.snapshot().waiting).toHaveLength(1),
    );
    expect(start).not.toHaveBeenCalled();
    const agent = createRuntimeAgent({
      id: "api",
      name: "API",
      instructions: "Answer",
      model: fakeRuntimeModel().model,
      context,
    });
    expect((await agent.generate("Continue")).text).toBe("answer");
    expect(start).not.toHaveBeenCalled();
    await blocker.close();
    expect(await pending).toBe("result");
    expect(start).toHaveBeenCalledOnce();
    expect(world.scheduler.snapshot().active).toEqual([]);
  } finally {
    await blocker.close();
    await world.scheduler.shutdown();
    await Promise.allSettled([pending]);
  }
});

it("cancels a queued ACP request without spawning or consuming a second lease", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const blocker = await world.scheduler.open(
    owner("occupied"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const { context, controller } = await runtimeContext();
  const start = vi.fn(async () => nativeSession());
  const pending = runRuntimeAcpTurn(
    { context, scheduler: world.scheduler, provider: "codex_cli", start },
    "task",
  );
  const rejected = expect(pending).rejects.toThrow();
  try {
    await vi.waitFor(() =>
      expect(world.scheduler.snapshot().waiting).toHaveLength(1),
    );
    controller.abort();
    await rejected;
    expect(start).not.toHaveBeenCalled();
    expect(world.records.size).toBe(1);
    expect(world.scheduler.snapshot().waiting).toEqual([]);
  } finally {
    await blocker.close();
    await world.scheduler.shutdown();
  }
});

it("holds capacity through closeout and does not return native output until it is confirmed", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const { context } = await runtimeContext();
  const cleanup = deferred<PlanSessionClosed>();
  const native = nativeSession();
  native.close.mockReturnValue(cleanup.promise);
  const pending = runRuntimeAcpTurn(
    {
      context,
      scheduler: world.scheduler,
      provider: "codex_cli",
      start: async () => native,
    },
    "task",
  );
  try {
    await vi.waitFor(() => expect(native.close).toHaveBeenCalledOnce());
    expect(world.scheduler.snapshot().active).toMatchObject([
      { state: "closing" },
    ]);
    expect(world.store.remove).not.toHaveBeenCalled();
    cleanup.resolve(closed());
    expect(await pending).toBe("result");
    expect(world.records.size).toBe(0);
  } finally {
    cleanup.resolve(closed());
    await world.scheduler.shutdown();
  }
});

it("preserves uncertain leases and refuses successful output on unconfirmed cleanup", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const { context } = await runtimeContext();
  const native = nativeSession();
  native.close.mockResolvedValue(closed(false));
  try {
    await expect(
      runRuntimeAcpTurn(
        {
          context,
          scheduler: world.scheduler,
          provider: "codex_cli",
          start: async () => native,
        },
        "task",
      ),
    ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
    expect(world.scheduler.snapshot().active).toMatchObject([
      { state: "cleanup_failed" },
    ]);
    expect(world.store.remove).not.toHaveBeenCalled();
  } finally {
    await world.scheduler.shutdown();
  }
});

it.each(["failed", "rejected", "cancelled"] as const)(
  "closes ACP sessions after %s turns without returning their output",
  async (outcome) => {
    const world = resourceWorld();
    await world.scheduler.recover();
    const { context, controller } = await runtimeContext();
    const turn = deferred<PlanSessionTurn>();
    const native = { ...nativeSession(), turn: turn.promise };
    const start = vi.fn(async () => native);
    const pending = runRuntimeAcpTurn(
      { context, scheduler: world.scheduler, provider: "codex_cli", start },
      "task",
    );
    const rejected = expect(pending).rejects.toThrow();
    try {
      await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
      if (outcome === "cancelled") controller.abort();
      if (outcome === "rejected")
        turn.resolve({ ...completedTurn(), errorCode: "provider_invalid" });
      else
        turn.resolve({
          ...completedTurn(),
          failure: outcome === "failed" ? "failed" : null,
        });
      await rejected;
      expect(native.close).toHaveBeenCalledOnce();
      expect(world.records.size).toBe(0);
    } finally {
      turn.resolve(completedTurn());
      await world.scheduler.shutdown();
    }
  },
);

it("cleans up a failed ACP start through the existing scheduler", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const { context } = await runtimeContext();
  try {
    await expect(
      runRuntimeAcpTurn(
        {
          context,
          scheduler: world.scheduler,
          provider: "codex_cli",
          start: async () => {
            throw new Error("Fake start failed");
          },
        },
        "task",
      ),
    ).rejects.toThrow("Fake start failed");
    expect(world.cleanup).toHaveBeenCalledOnce();
    expect(world.records.size).toBe(0);
  } finally {
    await world.scheduler.shutdown();
  }
});

it("rejects unsupported model capabilities before requesting any ACP resource", async () => {
  const world = resourceWorld();
  const { context } = await runtimeContext();
  const start = vi.fn(async () => nativeSession());
  const model = createRuntimeAcpModel({
    context,
    scheduler: world.scheduler,
    provider: "codex_cli",
    modelId: "native-model",
    start,
  });
  const requests: ModelRequest[] = [
    {
      prompt: [],
      tools: [{ type: "function", name: "native", inputSchema: {} }],
    },
    { prompt: [], responseFormat: { type: "json" } },
    { prompt: [{ role: "tool", content: [] }] },
    {
      prompt: [
        {
          role: "user",
          content: [
            { type: "file", mediaType: "text/plain", data: new Uint8Array() },
          ],
        },
      ],
    },
  ];
  for (const request of requests)
    await expect(model.doStream(request)).rejects.toThrow("ACP text models");
  expect(start).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().waiting).toEqual([]);
  expect(world.store.save).not.toHaveBeenCalled();
});

it("closes sessions when the native turn promise rejects", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const { context } = await runtimeContext();
  const completion = deferred<void>();
  const native = {
    ...nativeSession(),
    turn: completion.promise.then(() => {
      throw new Error("Synthetic native failure");
    }),
  };
  const start = vi.fn(async () => native);
  const pending = runRuntimeAcpTurn(
    { context, scheduler: world.scheduler, provider: "codex_cli", start },
    "task",
  );
  const rejected = expect(pending).rejects.toThrow("Synthetic native failure");
  try {
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    completion.resolve();
    await rejected;
    expect(native.close).toHaveBeenCalledOnce();
    expect(world.records.size).toBe(0);
  } finally {
    completion.resolve();
    await world.scheduler.shutdown();
  }
});
