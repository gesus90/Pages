import { describe, expect, it, vi } from "vitest";

import { AssistantHistoryScheduler } from "@/backend/service/assistant/AssistantHistoryScheduler";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";

import { createAssistantHarness } from "../helpers/text-assistant";
import { useMigratedDatabase } from "../helpers/test-database";

describe("assistant lifecycle", () => {
  const getDatabase = useMigratedDatabase();

  it("runs startup/hourly history cleanup once and drains shutdown", async () => {
    const { conversations } = await createAssistantHarness(getDatabase());
    const sweep = vi.spyOn(conversations, "sweep").mockResolvedValue(undefined);
    const scheduler = new AssistantHistoryScheduler(conversations);
    vi.useFakeTimers();
    try {
      scheduler.start();
      scheduler.start();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(sweep).toHaveBeenCalledTimes(2);
      await scheduler.shutdown();
      await scheduler.shutdown();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap cleanup and uses a fixed diagnostic for failures", async () => {
    const { conversations } = await createAssistantHarness(getDatabase());
    let finish: () => void = () => undefined;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sweep = vi.spyOn(conversations, "sweep").mockReturnValueOnce(delayed);
    const scheduler = new AssistantHistoryScheduler(conversations);
    const first = scheduler.runOnce();
    await scheduler.runOnce();
    expect(sweep).toHaveBeenCalledTimes(1);
    finish();
    await first;
    sweep.mockRejectedValueOnce(new Error("private diagnostic"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await scheduler.runOnce();
    expect(warn).toHaveBeenCalledWith(
      "Pages could not delete expired assistant histories.",
    );
  });

  it("limits requests per user, owns cancellation, handles deadlines and drains shutdown", async () => {
    const registry = new AssistantRequestRegistry();
    const work = vi.fn(
      async (signal: AbortSignal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const pending = registry.run("alice", "one", work);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await expect(registry.run("bob", "one", work)).rejects.toThrow(
      "requestBusy",
    );
    await expect(registry.run("alice", "two", work)).rejects.toThrow(
      "requestBusy",
    );
    await vi.waitFor(() => expect(work).toHaveBeenCalled());
    registry.cancel("bob", "one");
    registry.cancel("bob", "missing");
    await registry.shutdown();
    await rejected;
    await expect(registry.run("bob", "new", work)).rejects.toThrow(
      "requestBusy",
    );
    const timeoutRegistry = new AssistantRequestRegistry();
    vi.useFakeTimers();
    try {
      const timed = timeoutRegistry.run("alice", "timed", work);
      const expired = expect(timed).rejects.toThrow("timeout");
      await vi.advanceTimersByTimeAsync(120_000);
      await expired;
    } finally {
      vi.useRealTimers();
    }
    expect(
      await new AssistantRequestRegistry().run(
        "alice",
        "successful",
        async () => "complete",
      ),
    ).toBe("complete");
    await expect(
      new AssistantRequestRegistry().run("alice", "failed", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
  });

  it("bounds the instance-wide queue even for different owners", async () => {
    const registry = new AssistantRequestRegistry();
    let finish: () => void = () => undefined;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = Array.from({ length: 8 }, (_, index) =>
      registry.run(`owner-${index}`, `request-${index}`, async () => {
        await delayed;
        return index;
      }),
    );
    await expect(
      registry.run("ninth", "request-9", async () => 9),
    ).rejects.toThrow("requestBusy");
    finish();
    expect(await Promise.all(pending)).toHaveLength(8);
  });
});
