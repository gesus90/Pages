import { expect, it, vi } from "vitest";

import { PicaMobilePlansHandler } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PicaMobilePlansHost } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";
import type { PicaMobilePlansProvider } from "@/backend/service/mobile/plans/PicaMobilePlansProvider";

const SYNC = {
  type: "plans_sync" as const,
  requestId: "request",
  payload: { since: null },
};

it("sends a full list, then an unchanged receipt and an incremental change", async () => {
  const readPlans = vi.fn().mockResolvedValue({
    kind: "ready",
    rows: [{ id: "plan", name: "Plan", status: "idle" }],
  });
  const stopWatching = vi.fn();
  const watch = vi.fn(() => stopWatching);
  const provider = partial<PicaMobilePlansProvider>({
    open: () => ({ readPlans }),
    watch,
  });
  const send = vi.fn<(frame: string) => boolean>(() => true);
  const acknowledge = vi.fn();
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    session: () => ({ userId: "user", sessionToken: "token" }),
    send,
    acknowledge,
  });
  const handler = new PicaMobilePlansHandler(provider, host);
  await handler.handle(SYNC);
  expect(JSON.parse(send.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
    payload: { seq: 1, full: true, plans: [{ id: "plan" }] },
  });
  await handler.handle({ ...SYNC, payload: { since: 1 } });
  expect(JSON.parse(send.mock.calls[1]?.[0] ?? "{}")).toMatchObject({
    payload: { seq: 1 },
  });
  readPlans.mockResolvedValueOnce({
    kind: "ready",
    rows: [{ id: "plan", name: "Changed", status: "idle" }],
  });
  await handler.handle({ ...SYNC, payload: { since: 1, flow: true } });
  expect(JSON.parse(send.mock.calls[2]?.[0] ?? "{}")).toMatchObject({
    payload: { seq: 2, plans: [{ id: "plan", name: "Changed" }] },
  });
  expect(JSON.parse(send.mock.calls[2]?.[0] ?? "{}")).not.toHaveProperty(
    "payload.full",
  );
  expect(readPlans).toHaveBeenLastCalledWith(
    { userId: "user", sessionToken: "token" },
    { withState: true },
  );
  expect(acknowledge).toHaveBeenCalledTimes(3);
  expect(watch).toHaveBeenCalledTimes(1);
  handler.stop();
  expect(stopWatching).toHaveBeenCalledOnce();
});

it("rejects unavailable and unauthenticated requests and ends expired sessions", async () => {
  const reject = vi.fn();
  const rejectUnauthenticated = vi.fn();
  const endSession = vi.fn();
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    session: () => null,
    reject,
    rejectUnauthenticated,
    endSession,
  });
  await new PicaMobilePlansHandler(undefined, host).handle(SYNC);
  expect(reject).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "request" }),
  );
  const reader = {
    readPlans: vi.fn(async () => ({ kind: "sessionEnded" as const })),
  };
  const provider = partial<PicaMobilePlansProvider>({ open: () => reader });
  await new PicaMobilePlansHandler(provider, host).handle(SYNC);
  expect(rejectUnauthenticated).toHaveBeenCalledWith("request");
  const authenticated = partial<PicaMobilePlansHost>({
    ...host,
    session: () => ({ userId: "user", sessionToken: "token" }),
  });
  await new PicaMobilePlansHandler(provider, authenticated).handle(SYNC);
  expect(endSession).toHaveBeenCalledWith("request");
});

it("answers a plan request and reports a provider error without claiming success", async () => {
  const readPlan = vi.fn().mockResolvedValue({
    kind: "ready",
    payload: { planId: "plan", access: "gone" },
  });
  const provider = partial<PicaMobilePlansProvider>({
    open: () => ({ readPlan }),
  });
  const send = vi.fn<(frame: string) => boolean>(() => true);
  const acknowledge = vi.fn();
  const reportFailure = vi.fn();
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    session: () => ({ userId: "user", sessionToken: "token" }),
    send,
    acknowledge,
    reportFailure,
  });
  const handler = new PicaMobilePlansHandler(provider, host);
  const message = {
    type: "plan_get" as const,
    requestId: "get",
    payload: { planId: "plan", flow: true },
  };
  await handler.handle(message);
  expect(JSON.parse(send.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
    payload: { planId: "plan", access: "gone" },
  });
  expect(readPlan).toHaveBeenCalledWith(
    { userId: "user", sessionToken: "token" },
    "plan",
    { withFlow: true },
  );
  readPlan.mockRejectedValueOnce(new Error("unavailable"));
  await handler.handle(message);
  expect(reportFailure).toHaveBeenCalledWith("get", expect.any(Error));
  expect(acknowledge).toHaveBeenCalledOnce();
});

it("does not commit a sequence when sending its frame fails", async () => {
  const readPlans = vi.fn().mockResolvedValue({
    kind: "ready",
    rows: [{ id: "plan", name: "Plan", status: "idle" }],
  });
  const provider = partial<PicaMobilePlansProvider>({
    open: () => ({ readPlans }),
    watch: () => () => undefined,
  });
  const send = vi
    .fn<(frame: string) => boolean>()
    .mockReturnValueOnce(false)
    .mockReturnValue(true);
  const host = partial<PicaMobilePlansHost>({
    isOpen: () => true,
    session: () => ({ userId: "user", sessionToken: "token" }),
    send,
    acknowledge: () => undefined,
  });
  const handler = new PicaMobilePlansHandler(provider, host);
  await handler.handle(SYNC);
  await handler.handle(SYNC);
  expect(JSON.parse(send.mock.calls[1]?.[0] ?? "{}")).toMatchObject({
    payload: { seq: 1, full: true },
  });
  handler.stop();
});
