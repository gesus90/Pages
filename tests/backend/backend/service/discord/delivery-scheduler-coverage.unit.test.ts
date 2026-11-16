import { afterEach, expect, it, vi } from "vitest";

import { DiscordDeliveryScheduler } from "@/backend/service/discord/DiscordDeliveryScheduler";

afterEach(() => vi.useRealTimers());

it("runs immediately on start and periodically until stopped", async () => {
  vi.useFakeTimers();
  const runDue = vi.fn(async () => undefined);
  const scheduler = new DiscordDeliveryScheduler({ runDue }, 1000);
  scheduler.start();
  scheduler.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(runDue).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(runDue).toHaveBeenCalledTimes(2);
  scheduler.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(runDue).toHaveBeenCalledTimes(2);
});

it("reports a failed delivery round without throwing", async () => {
  const scheduler = new DiscordDeliveryScheduler({
    runDue: async () => {
      throw new Error("offline");
    },
  });
  await expect(scheduler.run()).resolves.toBe(false);
});
