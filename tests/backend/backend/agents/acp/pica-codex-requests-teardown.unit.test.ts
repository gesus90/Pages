import { expect, it } from "vitest";

import { PicaCodexRequests } from "@/backend/agents/acp/PicaCodexRequests";

import {
  THREAD,
  TOOLS,
  TURN,
  boundRig,
  call,
  deferred,
  liveSignal,
  outcome,
  pngData,
  turnRig,
} from "./pica-codex-requests-harness";

it("ends a turn idempotently and refuses unknown turns", async () => {
  const r = await turnRig();

  await r.requests.endTurn(THREAD, TURN);
  await expect(r.requests.endTurn(THREAD, TURN)).resolves.toBeUndefined();
  await expect(r.requests.endTurn(THREAD, "turn-9")).rejects.toThrow(
    "Pica turn refused",
  );
  await expect(r.requests.endTurn("other", TURN)).rejects.toThrow(
    "Pica turn refused",
  );
});

it("waits for the admitted client operation to settle before a turn ends", async () => {
  const r = await turnRig();
  const pending = deferred();
  r.invoke.mockReturnValueOnce(pending.promise);
  const running = r.requests.dispatch(call(), liveSignal());
  let ended = false;

  const ending = r.requests.endTurn(THREAD, TURN).then(() => {
    ended = true;
  });
  await Promise.resolve();
  expect(ended).toBe(false);
  pending.settle(outcome());
  await ending;

  expect(ended).toBe(true);
  await expect(running).rejects.toThrow("Pica call refused");
});

it("cancelTurn ends the active turn and tolerates having none", async () => {
  const r = await turnRig();

  await r.requests.cancelTurn();
  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica turn refused",
  );

  const unbound = new PicaCodexRequests({
    listener: { catalog: async () => TOOLS, capture: r.capture },
    session: () => null,
    prompting: () => false,
  });
  await expect(unbound.cancelTurn()).resolves.toBeUndefined();
});

it("closeThread revokes the thread and can be repeated", async () => {
  const r = await turnRig();

  await r.requests.closeThread(THREAD);
  await r.requests.closeThread(THREAD);

  expect(() => r.requests.confirmThread(THREAD)).toThrow("Pica thread refused");
  expect(r.requests.bindTurn(THREAD, "turn-2")).toBe(false);
  await expect(r.requests.catalog()).rejects.toThrow("Pica request refused");
  await expect(r.requests.endTurn(THREAD, TURN)).resolves.toBeUndefined();
});

it("closeThread joins a concurrent close and refuses a foreign thread", async () => {
  const r = await turnRig();

  const both = Promise.all([
    r.requests.closeThread(THREAD),
    r.requests.closeThread(THREAD),
  ]);

  await expect(both).resolves.toEqual([undefined, undefined]);
  await expect(r.requests.closeThread("other")).rejects.toThrow(
    "Pica thread refused",
  );
});

it("closeThread waits for a running call", async () => {
  const r = await turnRig();
  const pending = deferred();
  r.invoke.mockReturnValueOnce(pending.promise);
  const running = r.requests.dispatch(call(), liveSignal());
  let closed = false;

  const closing = r.requests.closeThread(THREAD).then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  pending.settle(outcome());
  await closing;

  expect(closed).toBe(true);
  await expect(running).rejects.toThrow("Pica call refused");
});

it("close aborts the active call, drops receipts and forgets the binding", async () => {
  const r = await turnRig();
  r.invoke.mockResolvedValueOnce(
    outcome({ images: [{ mimeType: "image/png", data: pngData(12) }] }),
  );
  await r.requests.dispatch(call(), liveSignal());

  r.requests.close();

  expect(r.invoke.mock.calls[0][1].aborted).toBe(true);
  expect(() => r.requests.confirmThread(THREAD)).toThrow("Pica thread refused");
  expect(r.requests.bindTurn(THREAD, "turn-2")).toBe(false);
  expect(r.requests.bindThread(THREAD)).toBe(false);
  expect(r.requests.catalogContext()).toBeNull();
});

it("close without an active turn only resets the state", async () => {
  const r = await boundRig();

  expect(() => r.requests.close()).not.toThrow();
  expect(() => r.requests.confirmThread(THREAD)).toThrow("Pica thread refused");
});
