import { afterEach, expect, it, vi } from "vitest";

import { LiveChangeHub } from "@/backend/service/events/LiveChangeHub";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import type { User } from "@/definition/User";

afterEach(() => {
  vi.useRealTimers();
});

it("rechecks account rights, coalesces events and ends on abort", async () => {
  vi.useFakeTimers();
  const notice = vi.fn(async (user: User, event: { id: string }) => {
    expect(user.id).toBe("user");
    return { kind: "ticket", id: event.id };
  });
  const hub = new LiveChangeHub(
    { subscribe: () => () => undefined },
    partial<LiveChangeAudience>({ notice }),
  );
  const account = vi.fn(async () => ({
    user: partial<User>({ id: "user" }),
    version: "new",
  }));
  const controller = new AbortController();
  const reader = hub
    .open({ account, version: "old", signal: controller.signal })
    .getReader();
  const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toContain("retry: 3000");
  await vi.advanceTimersByTimeAsync(50);
  expect(decoder.decode((await reader.read()).value)).toContain(
    "event: resync",
  );
  hub.receive({ type: "ticket.updated", id: "ticket" });
  hub.receive({ type: "ticket.updated", id: "ticket" });
  await vi.advanceTimersByTimeAsync(50);
  expect(decoder.decode((await reader.read()).value)).toContain(
    '"id":"ticket"',
  );
  expect(notice).toHaveBeenCalledOnce();
  expect(account).toHaveBeenCalledTimes(2);
  controller.abort();
  expect((await reader.read()).done).toBe(true);
});

it("closes streams after a session ends and emits anonymous resyncs", async () => {
  vi.useFakeTimers();
  const hub = new LiveChangeHub(
    { subscribe: () => () => undefined },
    partial<LiveChangeAudience>({ notice: async () => null }),
  );
  const account = vi
    .fn()
    .mockResolvedValueOnce({
      user: partial<User>({ id: "user" }),
      version: "v",
    })
    .mockResolvedValue(null);
  const reader = hub
    .open({ account, version: "v", signal: new AbortController().signal })
    .getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(50);
  hub.resyncAll();
  await vi.advanceTimersByTimeAsync(50);
  expect((await reader.read()).done).toBe(true);
});
