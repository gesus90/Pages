import { beforeEach, describe, expect, it, vi } from "vitest";

import { releaseEndedOwner } from "@/backend/agents/local/LocalSessionEndedOwner";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

const logger = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => logger);

const entry: LocalSessionEntry = {
  instanceId: "instance",
  instanceKey: "key",
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  manifestDigest: "digest",
  proof: null,
  acknowledgedSequence: 0,
  acknowledgedDigest: "",
  checkpointFile: null,
  releasedAt: null,
};

beforeEach(() => {
  logger.logCaughtError.mockClear();
  logger.logEvent.mockClear();
});

describe("releaseEndedOwner", () => {
  it("logs the release when the owner is proven ended", async () => {
    const settle = vi.fn(async () => true);
    await expect(releaseEndedOwner(entry, settle)).resolves.toBe(true);
    expect(settle).toHaveBeenCalledWith(entry);
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "agent.local_owner.ended",
        metadata: { instanceId: "instance", runId: "run" },
      }),
    );
  });

  it("keeps the owner uncertain while the settlement is not confirmed", async () => {
    await expect(releaseEndedOwner(entry, async () => false)).resolves.toBe(
      false,
    );
    expect(logger.logEvent).not.toHaveBeenCalled();
  });

  it("keeps the owner uncertain when the settlement fails", async () => {
    const failure = new Error("unreadable");
    await expect(
      releaseEndedOwner(entry, async () => {
        throw failure;
      }),
    ).resolves.toBe(false);
    expect(logger.logCaughtError).toHaveBeenCalledWith(
      "LocalSessions",
      failure,
    );
    expect(logger.logEvent).not.toHaveBeenCalled();
  });
});
