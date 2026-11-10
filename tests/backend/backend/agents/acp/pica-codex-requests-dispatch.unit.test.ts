import { afterEach, expect, it, vi } from "vitest";

import {
  THREAD,
  TURN,
  boundRig,
  call,
  deferred,
  liveSignal,
  outcome,
  pngData,
  policyRig,
  turnRig,
} from "./pica-codex-requests-harness";

afterEach(() => {
  vi.useRealTimers();
});

const png = (bytes: number): { mimeType: "image/png"; data: string } => ({
  mimeType: "image/png",
  data: pngData(bytes),
});

interface Answer {
  readonly receipt: string;
  readonly images: readonly { mimeType: string; length: number }[];
}

function chunkInput(
  receipt: string,
  image: number,
  offset: number,
  part: Record<string, unknown> = {},
): Parameters<Awaited<ReturnType<typeof turnRig>>["requests"]["chunk"]>[0] {
  return {
    threadId: THREAD,
    turnId: TURN,
    callId: "call-1",
    receipt,
    image,
    offset,
    ...part,
  };
}

async function withImages(
  images: readonly { mimeType: "image/png"; data: string }[],
): Promise<{ r: Awaited<ReturnType<typeof turnRig>>; answer: Answer }> {
  const r = await turnRig();
  r.invoke.mockResolvedValueOnce(
    outcome({ result: "img", images: [...images] }),
  );
  const answer = (await r.requests.dispatch(call(), liveSignal())) as Answer;
  return { r, answer };
}

it("returns the tool text and hands the call and a combined signal to the binding", async () => {
  const r = await turnRig();

  await expect(r.requests.dispatch(call(), liveSignal())).resolves.toEqual({
    success: true,
    text: "done",
    receipt: null,
    images: [],
  });
  expect(r.invoke).toHaveBeenCalledWith(call(), expect.any(AbortSignal));
});

it("reports failures with the error text or a FAILED fallback", async () => {
  const r = await turnRig();
  r.invoke.mockResolvedValueOnce(outcome({ ok: false, error: "no access" }));
  await expect(
    r.requests.dispatch(call(), liveSignal()),
  ).resolves.toMatchObject({
    success: false,
    text: "no access",
  });

  r.invoke.mockResolvedValueOnce(outcome({ ok: false }));
  await expect(
    r.requests.dispatch(call({ callId: "call-2" }), liveSignal()),
  ).resolves.toMatchObject({ success: false, text: "FAILED" });

  r.invoke.mockResolvedValueOnce(outcome());
  await expect(
    r.requests.dispatch(call({ callId: "call-3" }), liveSignal()),
  ).resolves.toMatchObject({ success: true, text: "" });
});

it("refuses a call outside an active turn", async () => {
  const r = await boundRig();

  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica turn refused",
  );
});

it.each([
  { label: "a foreign thread", change: { threadId: "other" } },
  { label: "a foreign turn", change: { turnId: "turn-9" } },
])("refuses a call with $label", async ({ change }) => {
  const r = await turnRig();

  await expect(r.requests.dispatch(call(change), liveSignal())).rejects.toThrow(
    "Pica turn refused",
  );
});

it("refuses a call when the prompt ended or the binding went stale", async () => {
  const r = await turnRig();

  r.state.prompting = false;
  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica turn refused",
  );

  r.state.prompting = true;
  r.state.current = false;
  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica turn refused",
  );
  expect(r.invoke).not.toHaveBeenCalled();
});

it("refuses a call whose signal is already aborted", async () => {
  const r = await turnRig();
  const aborted = new AbortController();
  aborted.abort();

  await expect(r.requests.dispatch(call(), aborted.signal)).rejects.toThrow();
  expect(r.invoke).not.toHaveBeenCalled();
});

it("refuses unknown tools, replayed call ids and oversized arguments", async () => {
  const r = await turnRig();
  const signal = liveSignal();

  await expect(
    r.requests.dispatch(call({ tool: "drop_database" }), signal),
  ).rejects.toThrow("Pica call refused");

  await r.requests.dispatch(call(), signal);
  await expect(r.requests.dispatch(call(), signal)).rejects.toThrow(
    "Pica call refused",
  );

  const big = call({
    callId: "big",
    arguments: { text: "x".repeat(1024 * 1024) },
  });
  await expect(r.requests.dispatch(big, signal)).rejects.toThrow(
    "Pica call refused",
  );
  expect(r.invoke).toHaveBeenCalledTimes(1);
});

it("limits the calls of one turn", async () => {
  const r = await turnRig();
  for (let index = 0; index < 4096; index += 1)
    await r.requests.dispatch(call({ callId: `call-${index}` }), liveSignal());

  await expect(
    r.requests.dispatch(call({ callId: "call-over" }), liveSignal()),
  ).rejects.toThrow("Pica call refused");
});

it("refuses a second call while the first is still pending", async () => {
  const r = await turnRig();
  const first = deferred();
  r.invoke.mockReturnValueOnce(first.promise);

  const running = r.requests.dispatch(call(), liveSignal());
  await expect(
    r.requests.dispatch(call({ callId: "call-2" }), liveSignal()),
  ).rejects.toThrow("Pica call refused");
  first.settle(outcome({ result: "late" }));

  await expect(running).resolves.toMatchObject({ text: "late" });
});

it("hides a binding failure behind a generic refusal", async () => {
  const r = await turnRig();
  r.invoke.mockRejectedValueOnce(new Error("database password"));

  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica call refused",
  );
});

it("drops the result and aborts the binding when the turn ends mid-call", async () => {
  const r = await turnRig();
  const pending = deferred();
  r.invoke.mockReturnValueOnce(pending.promise);

  const running = r.requests.dispatch(call(), liveSignal());
  const ending = r.requests.endTurn(THREAD, TURN);
  expect(r.invoke.mock.calls[0][1].aborted).toBe(true);
  pending.settle(outcome({ result: "late" }));

  await expect(running).rejects.toThrow("Pica call refused");
  await expect(ending).resolves.toBeUndefined();
});

it("drops the result when the caller aborted while the call ran", async () => {
  const r = await turnRig();
  const caller = new AbortController();
  r.invoke.mockImplementationOnce(async () => {
    caller.abort();
    return outcome({ result: "late" });
  });

  await expect(r.requests.dispatch(call(), caller.signal)).rejects.toThrow(
    "Pica call refused",
  );
});

it("announces image metadata only and hands out bounded chunks in order", async () => {
  const first = png(600_000);
  const second = png(12);
  const { r, answer } = await withImages([first, second]);

  expect(answer.images).toEqual([
    { mimeType: "image/png", length: first.data.length },
    { mimeType: "image/png", length: second.data.length },
  ]);
  expect(answer.receipt).toMatch(/^[0-9a-f-]{36}$/u);

  const one = r.requests.chunk(chunkInput(answer.receipt, 0, 0));
  expect(one).toEqual({
    data: first.data.slice(0, 512 * 1024),
    next: 512 * 1024,
  });
  const two = r.requests.chunk(chunkInput(answer.receipt, 0, one.next));
  expect(two).toEqual({
    data: first.data.slice(512 * 1024),
    next: first.data.length,
  });
  const three = r.requests.chunk(chunkInput(answer.receipt, 1, 0));
  expect(three).toEqual({ data: second.data, next: second.data.length });

  expect(() => r.requests.chunk(chunkInput(answer.receipt, 1, 0))).toThrow(
    "Pica receipt refused",
  );
});

it.each([
  { label: "receipt", change: { receipt: "other" } },
  { label: "call", change: { callId: "call-9" } },
  { label: "image", change: { image: 1 } },
  { label: "offset", change: { offset: 5 } },
])("refuses a chunk with a wrong $label", async ({ change }) => {
  const { r, answer } = await withImages([png(600_000)]);

  expect(() =>
    r.requests.chunk(chunkInput(answer.receipt, 0, 0, change)),
  ).toThrow("Pica receipt refused");
  expect(r.requests.chunk(chunkInput(answer.receipt, 0, 0)).next).toBe(
    512 * 1024,
  );
});

it("refuses a chunk when no receipt exists", async () => {
  const r = await turnRig();

  expect(() => r.requests.chunk(chunkInput("x", 0, 0))).toThrow(
    "Pica receipt refused",
  );
});

it("revokes a receipt by timer after its lifetime", async () => {
  vi.useFakeTimers();
  const { r, answer } = await withImages([png(600_000)]);

  vi.advanceTimersByTime(30_001);

  expect(() => r.requests.chunk(chunkInput(answer.receipt, 0, 0))).toThrow(
    "Pica receipt refused",
  );
});

it("refuses an expired receipt whose timer has not fired yet", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { r, answer } = await withImages([png(600_000)]);

  vi.setSystemTime(Date.now() + 30_001);

  expect(() => r.requests.chunk(chunkInput(answer.receipt, 0, 0))).toThrow(
    "Pica receipt refused",
  );
});

it("blocks further calls until the receipt was fully read", async () => {
  const { r, answer } = await withImages([png(12)]);

  await expect(
    r.requests.dispatch(call({ callId: "call-2" }), liveSignal()),
  ).rejects.toThrow("Pica call refused");

  r.requests.chunk(chunkInput(answer.receipt, 0, 0));

  await expect(
    r.requests.dispatch(call({ callId: "call-2" }), liveSignal()),
  ).resolves.toMatchObject({ success: true });
});

it.each([
  {
    label: "more than four images",
    images: Array.from({ length: 5 }, () => png(12)),
  },
  {
    label: "a non-image payload",
    images: [{ mimeType: "image/png", data: "AAAA" }],
  },
  {
    label: "a mismatching mime type",
    images: [{ mimeType: "image/jpeg", data: pngData(12) }],
  },
])("refuses a result with $label", async ({ images }) => {
  const r = await turnRig();
  r.invoke.mockResolvedValueOnce(
    outcome({ images: images as [{ mimeType: "image/png"; data: string }] }),
  );

  await expect(r.requests.dispatch(call(), liveSignal())).rejects.toThrow(
    "Pica call refused",
  );
});

it("requires the operation identity for chunks under the policy build", async () => {
  const r = await policyRig();
  r.requests.admitReady(r.ready);
  r.invoke.mockResolvedValueOnce(outcome({ images: [png(12)] }));
  const answer = (await r.requests.dispatch(
    call(r.identity),
    liveSignal(),
  )) as Answer;

  expect(() => r.requests.chunk(chunkInput(answer.receipt, 0, 0))).toThrow(
    "Pica receipt refused",
  );
  const forged = chunkInput(answer.receipt, 0, 0, {
    ...r.identity,
    nonce: "bad",
  });
  expect(() => r.requests.chunk(forged)).toThrow("Pica receipt refused");
  const genuine = chunkInput(answer.receipt, 0, 0, r.identity);
  expect(r.requests.chunk(genuine).data).toHaveLength(16);
});
