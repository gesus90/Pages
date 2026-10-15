import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(async () => {
  world = createPeopleWorld();
  world.addPage({ id: "old", ownerId: "owner" });
  world.addPage({ id: "fresh", ownerId: "owner" });
  world.addAttachment({ id: "att", pageId: "old", storageName: "file-old" });
  world.addAttachment({
    id: "kept",
    pageId: "fresh",
    storageName: "file-kept",
  });
  await world.trashService().delete(world.actor("owner"), "old");
  world.state.expiredRoots = ["old"];
});

describe("running the cleanup", () => {
  it("removes expired trash with its files, prunes versions and sweeps orphans", async () => {
    world.files.sweepResult = 2;
    await world.facade().runMaintenance();
    expect(world.hasPage("old")).toBe(false);
    expect(world.hasPage("fresh")).toBe(true);
    expect(world.files.files.has("file-old")).toBe(false);
    expect(world.files.files.has("file-kept")).toBe(true);
    expect(world.state.prunes).toEqual([{ keepLast: 50, retentionDays: 90 }]);
    expect(world.files.sweeps).toEqual([
      { known: ["file-kept"], olderThanMilliseconds: 3_600_000 },
    ]);
  });

  it("uses the retention values an administrator saved", async () => {
    await world.settingsService().update(world.actor("admin"), {
      fileLimitBytes: 5 * 1024 * 1024,
      mediaLimitBytes: 5 * 1024 * 1024,
      trashRetentionDays: 7,
      versionKeepLast: 3,
      versionRetentionDays: 14,
    });
    await world.facade().runMaintenance();
    expect(world.state.prunes).toEqual([{ keepLast: 3, retentionDays: 14 }]);
  });

  it("keeps trash that has not expired and every live page", async () => {
    world.state.expiredRoots = [];
    await world.facade().runMaintenance();
    expect(world.hasPage("old")).toBe(true);
    expect(world.hasPage("fresh")).toBe(true);
    expect(world.files.files.has("file-old")).toBe(true);
  });
});

describe("the scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function schedulerFor(
    runMaintenance: () => Promise<void>,
  ): WikiMaintenanceScheduler {
    return new WikiMaintenanceScheduler({ runMaintenance }, 1000);
  }

  it("runs at once, then at every interval, and only one timer exists", async () => {
    const runMaintenance = vi.fn(async () => undefined);
    const scheduler = schedulerFor(runMaintenance);
    scheduler.start();
    scheduler.start();
    expect(runMaintenance).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(runMaintenance).toHaveBeenCalledTimes(4);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runMaintenance).toHaveBeenCalledTimes(4);
    scheduler.stop();
  });

  it("can be started again after it was stopped", async () => {
    const runMaintenance = vi.fn(async () => undefined);
    const scheduler = schedulerFor(runMaintenance);
    scheduler.start();
    scheduler.stop();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runMaintenance).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("reports a failed cleanup without throwing and keeps running", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const runMaintenance = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue(undefined);
    const scheduler = schedulerFor(runMaintenance);
    await expect(scheduler.runOnce()).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith(
      "Pages wiki maintenance failed.",
      expect.objectContaining({ message: "locked" }),
    );
    await expect(scheduler.runOnce()).resolves.toBe(true);
  });
});

describe("the facade", () => {
  it("removes the files of a page deleted for good", async () => {
    await world.facade().purge(world.actor("owner"), "old");
    expect(world.hasPage("old")).toBe(false);
    expect(world.files.removals).toEqual([["file-old"]]);
  });
});
