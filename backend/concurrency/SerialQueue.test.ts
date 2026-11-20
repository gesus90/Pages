import { expect, it } from "vitest";

import { SerialQueue } from "./SerialQueue";

it("serializes work and continues after a rejection", async () => {
  const queue = new SerialQueue();
  const order: string[] = [];
  const first = queue.run(async () => {
    order.push("first");
    throw new Error("failed");
  });
  const second = queue.run(async () => {
    order.push("second");
    return 42;
  });

  await expect(first).rejects.toThrow("failed");
  await expect(second).resolves.toBe(42);
  await queue.idle();
  expect(order).toEqual(["first", "second"]);
});
