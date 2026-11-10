import { afterEach, expect, it, vi } from "vitest";

import {
  THREAD,
  TOOLS,
  TURN,
  boundRig,
  call,
  liveSignal,
  policyRig,
  readyFor,
  rig,
} from "./pica-codex-requests-harness";

afterEach(() => {
  vi.useRealTimers();
});

it("prepares operations with a nonce, a uuid and increasing sequence numbers", async () => {
  const r = await boundRig(true);

  const first = r.requests.prepareTurn(THREAD);
  expect(first.nonce).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(first.sequence).toBe(1);

  await r.requests.cancelPrepare(THREAD, first.nonce);
  expect(r.requests.prepareTurn(THREAD).sequence).toBe(2);
});

it("refuses to prepare without a policy, for a foreign thread or twice", async () => {
  const plain = await boundRig();
  expect(() => plain.requests.prepareTurn(THREAD)).toThrow("Pica turn refused");

  const r = await boundRig(true);
  expect(() => r.requests.prepareTurn("other")).toThrow("Pica turn refused");

  r.requests.prepareTurn(THREAD);
  expect(() => r.requests.prepareTurn(THREAD)).toThrow("Pica turn refused");
});

it("refuses to prepare for an idle prompt or a stale binding", async () => {
  const r = await boundRig(true);

  r.state.prompting = false;
  expect(() => r.requests.prepareTurn(THREAD)).toThrow("Pica turn refused");

  r.state.prompting = true;
  r.state.current = false;
  expect(() => r.requests.prepareTurn(THREAD)).toThrow("Pica turn refused");
});

it("refuses to prepare while a native turn is active", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);

  expect(() => r.requests.prepareTurn(THREAD)).toThrow("Pica turn refused");
});

it("admits the prepared operation once and runs its calls with the identity", async () => {
  const r = await policyRig();

  expect(r.requests.admitReady(r.ready)).toBe(true);
  await expect(
    r.requests.dispatch(call(r.identity), liveSignal()),
  ).resolves.toMatchObject({ success: true, text: "done" });
  expect(r.invoke).toHaveBeenCalledTimes(1);
});

it("consumes the prepared turn even when admission is refused", async () => {
  const r = await policyRig();

  expect(r.requests.admitReady({ ...r.ready, nonce: "wrong" })).toBe(false);
  expect(r.requests.admitReady(r.ready)).toBe(false);
});

it.each([
  { label: "a foreign operation id", change: { operationId: "other" } },
  { label: "a foreign sequence", change: { sequence: 99 } },
  { label: "a foreign thread", change: { threadId: "other" } },
  { label: "a foreign context", change: { context: "f".repeat(64) } },
  {
    label: "a tampered registry",
    change: {
      catalog: [
        { type: "function" as const, ...TOOLS[0], description: "tampered" },
        { type: "function" as const, ...TOOLS[1] },
      ],
    },
  },
])("refuses admission with $label", async ({ change }) => {
  const r = await policyRig();

  expect(r.requests.admitReady({ ...r.ready, ...change })).toBe(false);
});

it("refuses admission after the preparation was cancelled", async () => {
  const r = await policyRig();
  await r.requests.cancelPrepare(THREAD, r.operation.nonce);

  expect(r.requests.admitReady(r.ready)).toBe(false);
});

it("refuses admission once the prepared turn expired", async () => {
  vi.useFakeTimers();
  const r = await policyRig();

  vi.advanceTimersByTime(30_001);

  expect(r.requests.admitReady(r.ready)).toBe(false);
});

it("refuses admission for a stale binding or an idle prompt", async () => {
  const stale = await policyRig();
  stale.state.current = false;
  expect(stale.requests.admitReady(stale.ready)).toBe(false);

  const idle = await policyRig();
  idle.state.prompting = false;
  expect(idle.requests.admitReady(idle.ready)).toBe(false);
});

it("refuses admission of a turn id that already ended", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);
  await r.requests.endTurn(THREAD, TURN);

  const next = r.requests.prepareTurn(THREAD);
  expect(r.requests.admitReady(readyFor(next, r.context))).toBe(false);

  const again = r.requests.prepareTurn(THREAD);
  expect(
    r.requests.admitReady(readyFor(again, r.context, { turnId: "turn-2" })),
  ).toBe(true);
});

it("cancels a pending preparation by nonce", async () => {
  const r = await policyRig();

  await expect(
    r.requests.cancelPrepare("other", r.operation.nonce),
  ).resolves.toBe(false);
  await expect(r.requests.cancelPrepare(THREAD, "wrong")).resolves.toBe(false);
  await expect(
    r.requests.cancelPrepare(THREAD, r.operation.nonce),
  ).resolves.toBe(true);
});

it("cancels an admitted turn by the nonce of its operation", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);

  await expect(r.requests.cancelPrepare(THREAD, "wrong")).resolves.toBe(false);
  await expect(
    r.requests.cancelPrepare(THREAD, r.operation.nonce),
  ).resolves.toBe(true);
  await expect(
    r.requests.dispatch(call(r.identity), liveSignal()),
  ).rejects.toThrow("Pica turn refused");
});

it("revokes a prepared operation named by a private control request", async () => {
  const r = await policyRig();

  await expect(r.requests.revokeOperation(r.ready)).resolves.toBe(true);
  expect(r.requests.admitReady(r.ready)).toBe(false);
});

it("revokes the admitted turn of the named operation", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);

  await expect(r.requests.revokeOperation(r.ready)).resolves.toBe(true);
  await expect(
    r.requests.dispatch(call(r.identity), liveSignal()),
  ).rejects.toThrow("Pica turn refused");
});

it.each([
  { label: "a foreign thread", change: { threadId: "other" } },
  { label: "a foreign context", change: { context: "f".repeat(64) } },
  { label: "a different registry", change: { catalog: [] } },
])("refuses revocation with $label", async ({ change }) => {
  const r = await policyRig();

  await expect(
    r.requests.revokeOperation({ ...r.ready, ...change }),
  ).resolves.toBe(false);
});

it("refuses revocation before a catalog was issued", async () => {
  const r = rig(true);
  r.state.session = THREAD;

  await expect(
    r.requests.revokeOperation(
      readyFor({ operationId: "o", nonce: "n", sequence: 1 }, "c"),
    ),
  ).resolves.toBe(false);
});

it.each([
  { label: "operation id", change: { operationId: "other" } },
  { label: "nonce", change: { nonce: "other" } },
  { label: "sequence", change: { sequence: 99 } },
  { label: "turn id", change: { turnId: "turn-9" } },
])("keeps the admitted turn when the $label differs", async ({ change }) => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);

  await expect(
    r.requests.revokeOperation({ ...r.ready, ...change }),
  ).resolves.toBe(false);
  await expect(
    r.requests.dispatch(call(r.identity), liveSignal()),
  ).resolves.toMatchObject({ success: true });
});

it("refuses revocation when neither a prepared nor an admitted turn exists", async () => {
  const r = await policyRig();
  await r.requests.cancelPrepare(THREAD, r.operation.nonce);

  await expect(r.requests.revokeOperation(r.ready)).resolves.toBe(false);
});

it("requires the operation identity on every call under the policy build", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);

  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica call refused",
  );
  await expect(
    r.requests.dispatch(call({ ...r.identity, nonce: "wrong" }), liveSignal()),
  ).rejects.toThrow("Pica call refused");
  expect(r.invoke).not.toHaveBeenCalled();
});

it("discards a prepared policy turn when the thread closes", async () => {
  const r = await policyRig();

  await r.requests.closeThread(THREAD);

  expect(r.requests.admitReady(r.ready)).toBe(false);
});

it("cancelTurn revokes the active native turn and any prepared one", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);
  await r.requests.cancelTurn();
  await expect(
    r.requests.dispatch(call(r.identity), liveSignal()),
  ).rejects.toThrow("Pica turn refused");

  const next = r.requests.prepareTurn(THREAD);
  await r.requests.cancelTurn();
  expect(r.requests.admitReady(readyFor(next, r.context))).toBe(false);
});
