import { expect, it, vi } from "vitest";

import { AgentSessionSlots } from "@/backend/service/employee/AgentSessionSlots";

it("grants the oldest eligible waiting agent without blocking another agent", async () => {
  const slots = new AgentSessionSlots(async () => ({ perAgent: 1, total: 2 }));
  const first = await slots.acquire("a");
  const queued = vi.fn();
  const nextA = slots.acquire("a", { onQueued: queued });
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  const firstB = await slots.acquire("b");
  expect(firstB.hasWaited).toBe(false);
  expect(slots.waiting).toBe(1);
  first.release();
  const secondA = await nextA;
  expect(secondA.hasWaited).toBe(true);
  expect(slots.running).toBe(2);
  secondA.release();
  secondA.release();
  firstB.release();
  expect(slots.running).toBe(0);
});

it("removes an aborted waiter without consuming a slot", async () => {
  const slots = new AgentSessionSlots(async () => ({ perAgent: 1, total: 1 }));
  const first = await slots.acquire("a");
  const controller = new AbortController();
  const queued = vi.fn();
  const pending = slots.acquire("a", {
    signal: controller.signal,
    onQueued: queued,
  });
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  const rejected = expect(pending).rejects.toThrow();
  controller.abort();
  await rejected;
  expect(slots.waiting).toBe(0);
  first.release();
  expect(slots.running).toBe(0);
  await expect(
    slots.acquire("a", { signal: controller.signal }),
  ).rejects.toThrow();
});

it("starts waiting work when limits increase and retains limits after a read failure", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ perAgent: 1, total: 1 })
    .mockRejectedValueOnce(new Error("offline"));
  const slots = new AgentSessionSlots(read);
  const first = await slots.acquire("a");
  const queued = vi.fn();
  const pending = slots.acquire("b", { onQueued: queued });
  await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
  slots.apply({ perAgent: 1, total: 2 });
  const second = await pending;
  expect(second.hasWaited).toBe(true);
  first.release();
  second.release();
});
