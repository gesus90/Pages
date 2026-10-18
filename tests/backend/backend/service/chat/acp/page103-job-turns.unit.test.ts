import { expect, it, vi } from "vitest";

import { completedTurn, PicaJobWorld } from "./page103-job-fixture";

const STEER = { id: "steer", text: "Also read this", attachments: [] };

it.each(["codex_cli", "claude_code", "opencode"] as const)(
  "allows 256 calls over %s and ends call 257 with a readable status and retained journal text",
  async (provider) => {
    const world = new PicaJobWorld(provider);
    const { completion } = await world.start();
    world.text("Partial answer");
    for (let call = 0; call < 256; call += 1)
      expect((await world.call()).ok).toBe(true);
    expect(await world.call()).toMatchObject({
      ok: false,
      error: "STEP_LIMIT",
    });
    await completion;
    expect(world.tools).toHaveBeenCalledTimes(256);
    expect(world.finish).toHaveBeenCalledWith("job", "failed", "stepLimit");
    expect(world.events).toContainEqual({
      kind: "text",
      turn: 1,
      isReset: false,
      delta: "Partial answer",
    });
    expect(world.close).toHaveBeenCalledOnce();
  },
);

it("shares the budget with steering injected into the running turn", async () => {
  const world = new PicaJobWorld();
  const { completion } = await world.start();
  for (let call = 0; call < 256; call += 1) await world.call();
  await world.job.steer(STEER);
  await vi.waitFor(() =>
    expect(world.steers.update).toHaveBeenCalledWith("steer", "accepted"),
  );
  expect((await world.call()).error).toBe("STEP_LIMIT");
  await completion;
  expect(world.tools).toHaveBeenCalledTimes(256);
});

it("starts a fresh budget for a queued follow-up and does not reset it twice at dequeue", async () => {
  const world = new PicaJobWorld();
  world.steer = async () => "promptRequired";
  world.next = async () => {
    for (let call = 0; call < 256; call += 1)
      expect((await world.call()).ok).toBe(true);
    world.listener?.prompted(null);
    return completedTurn("Second answer");
  };
  const { completion } = await world.start();
  for (let call = 0; call < 256; call += 1) await world.call();
  await world.job.steer(STEER);
  world.complete();
  await completion;
  expect(world.tools).toHaveBeenCalledTimes(512);
  expect(world.messages.map((message) => message.content)).toEqual([
    "Answer",
    "Second answer",
  ]);
  expect(world.steers.answer).toHaveBeenCalledWith("steer", "message-1");
});

it("counts early adapter follow-up calls before dequeue and refuses its 257th call", async () => {
  const world = new PicaJobWorld();
  world.steer = async () => {
    world.complete();
    world.thread(true);
    // ACP can already use the next turn's tools while the steer response is in flight.
    for (let call = 0; call < 256; call += 1)
      expect((await world.call()).ok).toBe(true);
    return "startedNewTurn";
  };
  const { completion } = await world.start();
  for (let call = 0; call < 256; call += 1) await world.call();
  await world.job.steer(STEER);
  await vi.waitFor(() =>
    expect(world.events).toContainEqual(
      expect.objectContaining({ kind: "turn", turn: 2, origin: "followUp" }),
    ),
  );
  expect((await world.call()).error).toBe("STEP_LIMIT");
  await completion;
  expect(world.tools).toHaveBeenCalledTimes(512);
  expect(world.finish).toHaveBeenCalledWith("job", "failed", "stepLimit");
});

it("gives a resumed session a fresh turn budget and preserves the resume identifier", async () => {
  for (let turn = 0; turn < 2; turn += 1) {
    const world = new PicaJobWorld("codex_cli", "existing-session");
    const { completion } = await world.start();
    for (let call = 0; call < 256; call += 1)
      expect((await world.call()).ok).toBe(true);
    world.complete();
    await completion;
    expect(world.resumeSessionId).toBe("existing-session");
    expect(world.finish).toHaveBeenCalledWith("job", "completed", null);
  }
});

it("preserves an explicitly stopped partial answer as a stored message", async () => {
  const world = new PicaJobWorld();
  const { completion } = await world.start();
  world.text("Keep this partial answer");
  world.job.stop();
  world.controller.abort("cancelled");
  await completion;
  expect(world.messages).toContainEqual(
    expect.objectContaining({
      content: "Keep this partial answer",
      isStopped: true,
    }),
  );
  expect(world.finish).toHaveBeenCalledWith("job", "stopped", null);
});

it("keeps the same budget for the single failed-resume fallback instead of granting another 256 calls", async () => {
  const world = new PicaJobWorld("codex_cli", "unavailable-session");
  world.opened.mockImplementationOnce(async () => {
    for (let call = 0; call < 128; call += 1) await world.call();
    return {
      turn: Promise.resolve({
        ...completedTurn(),
        errorCode: "acp_session_resume_failed",
        failure: "failed",
      }),
      close: world.close,
    };
  });
  const { completion } = await world.start();
  await vi.waitFor(() => expect(world.opened).toHaveBeenCalledTimes(2));
  for (let call = 0; call < 128; call += 1)
    expect((await world.call()).ok).toBe(true);
  expect((await world.call()).error).toBe("STEP_LIMIT");
  await completion;
  expect(world.tools).toHaveBeenCalledTimes(256);
  expect(world.resumeSessionId).toBeNull();
  expect(world.finish).toHaveBeenCalledWith("job", "failed", "stepLimit");
});
