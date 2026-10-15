import { expect, it, vi } from "vitest";

import {
  BackgroundSaveCoordinator,
  SupersededBackgroundSaveError,
} from "@/backend/service/BackgroundSaveCoordinator";

const order = {
  actorId: "owner",
  objectId: "wiki:page",
  streamId: "document",
  sequence: 1,
};

it("fences an older request even when the newer request confirmed unchanged content", async () => {
  const coordinator = new BackgroundSaveCoordinator();
  let stored = "original";
  await coordinator.run({ ...order, sequence: 2 }, async () => stored);
  await expect(
    coordinator.run(order, async () => {
      stored = "late edit";
      return stored;
    }),
  ).rejects.toBeInstanceOf(SupersededBackgroundSaveError);
  expect(stored).toBe("original");
});

it("executes active writes in order and refuses repeated sequences without another action", async () => {
  const coordinator = new BackgroundSaveCoordinator();
  let finish: () => void = () => {
    throw new Error("Not initialized");
  };
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = coordinator.run(order, async () => {
    await pending;
    return "first";
  });
  const laterWork = vi.fn(async () => "second");
  const second = coordinator.run({ ...order, sequence: 2 }, laterWork);
  expect(laterWork).not.toHaveBeenCalled();
  finish();
  expect(await first).toBe("first");
  expect(await second).toBe("second");
  await expect(
    coordinator.run({ ...order, sequence: 2 }, laterWork),
  ).rejects.toBeInstanceOf(SupersededBackgroundSaveError);
  expect(laterWork).toHaveBeenCalledOnce();
});

it("keeps streams isolated by account and object, and recovers after a rejected write", async () => {
  const coordinator = new BackgroundSaveCoordinator();
  await expect(
    coordinator.run({ ...order, sequence: 2 }, async () => {
      throw new Error("Unavailable");
    }),
  ).rejects.toThrow("Unavailable");
  const write = vi.fn(async () => "saved");
  expect(await coordinator.run({ ...order, sequence: 3 }, write)).toBe("saved");
  expect(
    await coordinator.run({ ...order, actorId: "someone else" }, write),
  ).toBe("saved");
  expect(
    await coordinator.run({ ...order, objectId: "ticket:page" }, write),
  ).toBe("saved");
  expect(write).toHaveBeenCalledTimes(3);
});
