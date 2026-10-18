import { afterEach, expect, it, vi } from "vitest";

import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import {
  CHAT_MAXIMUM_ACTIONS,
  CHAT_MAXIMUM_MODEL_STEPS,
  CHAT_REQUEST_TIMEOUT_MS,
} from "@/backend/service/chat/ChatExecutionLimits";
import { picaAcpRunner } from "@/backend/service/chat/acp/PicaAcpRunners";

import { responseChunks } from "../../agents/runtime/runtime-fixture";
import { ASSIGNMENT } from "./page48-chat-fixture";
import { picaToolCalls, picaWorld } from "./page83-pica-fixture";
import { ChatAgentWorld, modelAction } from "./page56-chat-world";

afterEach(() => vi.useRealTimers());

it("allows 256 sequential native calls and a final answer, then gives the same session a fresh budget", async () => {
  const world = picaWorld((_, step) =>
    step % 257 < 256
      ? picaToolCalls([{ tool: "projects_list", input: {} }])
      : responseChunks("Completed all 256"),
  );
  for (let turn = 0; turn < 2; turn += 1)
    expect(await world.service.run(world.input, world.controller.signal)).toBe(
      "Completed all 256",
    );
  expect(world.router).toHaveBeenCalledTimes(512);
  expect(world.provider.calls).toHaveBeenCalledTimes(514);
}, 30000);

it("lets legacy actions execute 256 actual calls after malformed input and still answer", async () => {
  const world = new ChatAgentWorld();
  const run = vi
    .spyOn(world.tools, "run")
    .mockResolvedValue({ ok: true, result: {} });
  const actions = Array.from({ length: 256 }, () =>
    modelAction("projects.list", {}),
  );
  const answer = await world.send("Read projects", [
    "```pages-action\n{\n```",
    ...actions,
    "Done",
  ]);
  expect(answer.answer.content).toBe("Done");
  expect(run).toHaveBeenCalledTimes(256);
  expect(world.prompts).toHaveLength(258);
  expect(world.prompts[0].instructions).toContain("256 Aktionen");
  expect(world.prompts.at(-1)?.prompt).toContain(
    "Weitere Aktionen sind nicht möglich",
  );
});

it("refuses legacy call 257 and does not consume the next message's budget", async () => {
  const world = new ChatAgentWorld();
  const run = vi
    .spyOn(world.tools, "run")
    .mockResolvedValue({ ok: true, result: {} });
  const actions = Array.from({ length: 257 }, () =>
    modelAction("projects.list", {}),
  );
  await expect(world.send("Read projects", actions)).rejects.toMatchObject({
    code: "stepLimit",
  });
  expect(run).toHaveBeenCalledTimes(256);
  expect(
    (await world.send("Read again", [modelAction("projects.list", {}), "Done"]))
      .answer.content,
  ).toBe("Done");
  expect(run).toHaveBeenCalledTimes(257);
});

it("keeps malformed legacy model loops finite independently of actual tool calls", async () => {
  const world = new ChatAgentWorld();
  const run = vi.spyOn(world.tools, "run");
  await expect(
    world.send(
      "Read",
      Array.from(
        { length: CHAT_MAXIMUM_MODEL_STEPS },
        () => "```pages-action\n{\n```",
      ),
    ),
  ).rejects.toMatchObject({ code: "stepLimit" });
  expect(run).not.toHaveBeenCalled();
  expect(world.prompts).toHaveLength(258);
});

it("keeps the chat deadline above five minutes, cancels at 90 minutes and releases admission", async () => {
  vi.useFakeTimers();
  expect(CHAT_MAXIMUM_ACTIONS).toBe(256);
  expect(CHAT_REQUEST_TIMEOUT_MS).toBe(256 * 20000 + 280000);
  const registry = new ChatRequestRegistry({
    timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
    capacity: 16,
  });
  let received: AbortSignal | null = null;
  const operation = registry.run("owner", "first", (signal) => {
    received = signal;
    return new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  });
  const outcome = expect(operation).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(300000);
  expect(received).toMatchObject({ aborted: false });
  registry.cancel("foreign", "first");
  expect(received).toMatchObject({ aborted: false });
  await expect(
    registry.run("owner", "second", async () => "unexpected"),
  ).rejects.toMatchObject({ code: "requestBusy" });
  await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS - 300000 - 1);
  expect(received).toMatchObject({ aborted: false });
  await vi.advanceTimersByTimeAsync(1);
  await outcome;
  expect(received).toMatchObject({ aborted: true, reason: "timeout" });
  expect(await registry.run("owner", "next", async () => "released")).toBe(
    "released",
  );
});

it.each(["codex_cli", "claude_code", "opencode"] as const)(
  "has no hidden shorter default deadline for %s and preserves explicit runner limits",
  (provider) => {
    const assignment = {
      ...ASSIGNMENT,
      connection: { ...ASSIGNMENT.connection, provider },
    };
    const runner = picaAcpRunner(assignment);
    expect(runner.runOptions(assignment).timeoutMinutes).toBe(0);
    const configured = {
      ...assignment,
      run: {
        access: "read_only" as const,
        shell: false,
        web: false,
        timeoutMinutes: 12,
      },
    };
    expect(runner.runOptions(configured).timeoutMinutes).toBe(
      provider === "codex_cli" ? 0 : 12,
    );
  },
);
