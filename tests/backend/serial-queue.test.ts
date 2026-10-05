import { describe, expect, it } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("SerialQueue", () => {
  it("returns the result of each task", async () => {
    const queue = new SerialQueue();

    await expect(queue.run(async () => "first")).resolves.toBe("first");
    await expect(queue.run(async () => 2)).resolves.toBe(2);
  });

  it("runs tasks one after another in submission order", async () => {
    const queue = new SerialQueue();
    const events: string[] = [];

    await Promise.all([
      queue.run(async () => {
        events.push("a:start");
        await delay(20);
        events.push("a:end");
      }),
      queue.run(async () => {
        events.push("b:start");
        await delay(1);
        events.push("b:end");
      }),
      queue.run(async () => {
        events.push("c:start");
        events.push("c:end");
      }),
    ]);

    expect(events).toEqual([
      "a:start",
      "a:end",
      "b:start",
      "b:end",
      "c:start",
      "c:end",
    ]);
  });

  it("reports a failing task to its caller and keeps running later tasks", async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error("task failed");
    });
    const following = queue.run(async () => "still runs");

    await expect(failing).rejects.toThrow("task failed");
    await expect(following).resolves.toBe("still runs");
  });

  it("is idle once every submitted task finished", async () => {
    const queue = new SerialQueue();
    let isFinished = false;

    void queue.run(async () => {
      await delay(10);
      isFinished = true;
    });
    await queue.idle();

    expect(isFinished).toBe(true);
  });

  it("is idle right away when nothing was submitted", async () => {
    await expect(new SerialQueue().idle()).resolves.toBeUndefined();
  });
});
