import { beforeEach, describe, expect, it, vi } from "vitest";

import { PagesEventRetention } from "./PagesEventRetention";

import type { PagesEventOutboxReaderRepository } from "@/backend/database/repositories/events/PagesEventOutboxReaderRepository";

const logger = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logger);

const LIMITS = { minimumAgeSeconds: 10, batchSize: 5, maximumBatches: 3 };

function repositoryOf(
  blocks: readonly { removed: number; prunedThrough: number }[],
): {
  repository: PagesEventOutboxReaderRepository;
  remove: ReturnType<typeof vi.fn>;
} {
  const remove = vi.fn();
  for (const block of blocks) remove.mockResolvedValueOnce(block);
  return {
    repository: {
      removeExpired: remove,
    } as unknown as PagesEventOutboxReaderRepository,
    remove,
  };
}

describe("PagesEventRetention", () => {
  beforeEach(() => {
    logger.logEvent.mockReset();
  });

  it("stops at an empty block and logs at debug level", async () => {
    const { repository } = repositoryOf([{ removed: 0, prunedThrough: 7 }]);
    const run = await new PagesEventRetention(repository, LIMITS).runOnce();
    expect(run).toEqual({ removed: 0, batches: 0, prunedThrough: 7 });
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "debug" }),
    );
  });

  it("stops after a short block and logs at info level", async () => {
    const { repository, remove } = repositoryOf([
      { removed: 5, prunedThrough: 5 },
      { removed: 2, prunedThrough: 7 },
    ]);
    const run = await new PagesEventRetention(repository, LIMITS).runOnce();
    expect(run).toEqual({ removed: 7, batches: 2, prunedThrough: 7 });
    expect(remove).toHaveBeenCalledWith(LIMITS);
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info" }),
    );
  });

  it("stops at the batch limit", async () => {
    const full = { removed: 5, prunedThrough: 9 };
    const { repository, remove } = repositoryOf([full, full, full, full]);
    const run = await new PagesEventRetention(repository, LIMITS).runOnce();
    expect(run.batches).toBe(3);
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it("uses the default limits of a week", async () => {
    const { repository, remove } = repositoryOf([
      { removed: 0, prunedThrough: 0 },
    ]);
    await new PagesEventRetention(repository).runOnce();
    expect(remove).toHaveBeenCalledWith({
      minimumAgeSeconds: 604_800,
      batchSize: 500,
      maximumBatches: 40,
    });
  });
});
