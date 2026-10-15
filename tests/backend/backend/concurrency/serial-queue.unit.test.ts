import { describe, expect, it } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

describe("SerialQueue", () => {
  it("runs tasks one after another in submission order", async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return 1;
    });
    const second = queue.run(async () => {
      events.push("second:start");
      return 2;
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("reports a failing task to its caller without blocking later tasks", async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error("write failed");
    });
    const following = queue.run(async () => "still runs");

    await expect(failing).rejects.toThrow("write failed");
    await expect(following).resolves.toBe("still runs");
  });

  it("resolves idle after every submitted task, also failed ones", async () => {
    const queue = new SerialQueue();
    let finished = false;
    void queue
      .run(async () => {
        throw new Error("boom");
      })
      .catch(() => undefined);
    void queue.run(async () => {
      finished = true;
    });

    await queue.idle();

    expect(finished).toBe(true);
  });
});
