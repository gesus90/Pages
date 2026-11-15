import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INSTANCE_ID,
  RUN_ID,
  directoryOf,
  entryOf,
  mocks,
  resetMocks,
} from "./local-sessions-fixture";
import { adopt, createSessions } from "./local-sessions-harness";

vi.mock(
  "@/backend/database/repositories/agent/LocalSessionRepository",
  async () => (await import("./local-sessions-fixture")).factories.repository(),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRunRepository",
  async () =>
    (await import("./local-sessions-fixture")).factories.runRepository(),
);
vi.mock("@/backend/storage/AgentPayloadFileStore", async () =>
  (await import("./local-sessions-fixture")).factories.payloadStore(),
);
vi.mock("@/backend/logging/Logger", async () =>
  (await import("./local-sessions-fixture")).factories.logger(),
);
vi.mock("@/backend/agents/local/LocalSessionOwnership", async () =>
  (await import("./local-sessions-fixture")).factories.ownership(),
);
vi.mock("@/backend/agents/local/LocalSessionFiles", async () =>
  (await import("./local-sessions-fixture")).factories.records(),
);
vi.mock("@/backend/agents/local/LocalSessionTransport", async () =>
  (await import("./local-sessions-fixture")).factories.transport(),
);
vi.mock("@/backend/agents/local/LocalSessionUnit", async () =>
  (await import("./local-sessions-fixture")).factories.unit(),
);
vi.mock("@/backend/agents/local/LocalSessionTools", async () =>
  (await import("./local-sessions-fixture")).factories.tools(),
);
vi.mock("node:fs/promises", async () =>
  (await import("./local-sessions-fixture")).factories.fsPromises(),
);
vi.mock("@/backend/agents/local/LocalSessionJournal", async () =>
  (await import("./local-sessions-fixture")).factories.journal(),
);
vi.mock("@/backend/agents/local/LocalSessionImport", async () =>
  (await import("./local-sessions-fixture")).factories.importer(),
);
vi.mock("@/backend/agents/local/LocalAttachedSession", async () =>
  (await import("./local-sessions-fixture")).factories.attached(),
);

const worker = vi.hoisted(() => ({ settle: vi.fn<() => Promise<number>>() }));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  settleWorkerUnits: worker.settle,
}));
beforeEach(() => {
  resetMocks();
  worker.settle.mockReset().mockResolvedValue(0);
});

describe("discover of an owner that ended outside Pages", () => {
  beforeEach(() => {
    mocks.ownership.proveLocalOwner.mockRejectedValue(
      new Error("Local owner process is not live"),
    );
  });

  it("releases an owner whose unit and process are provably gone instead of keeping it uncertain", async () => {
    mocks.ownership.hasEndedLocalOwner.mockResolvedValue(true);
    mocks.owners.list.mockResolvedValue([entryOf()]);
    const sessions = createSessions();

    const result = await sessions.discover();

    expect(mocks.ownership.hasEndedLocalOwner).toHaveBeenCalledWith(
      entryOf(),
      directoryOf(INSTANCE_ID),
    );
    expect(worker.settle).toHaveBeenCalledWith(INSTANCE_ID);
    expect(mocks.owners.released).toHaveBeenCalledWith(INSTANCE_ID);
    expect(result.uncertain.size).toBe(0);
    expect(sessions.unverified().size).toBe(0);
    expect(sessions.hasEnded(INSTANCE_ID)).toBe(true);
    expect(sessions.has(INSTANCE_ID)).toBe(false);
    expect(sessions.hasRun(RUN_ID)).toBe(false);
    expect(mocks.logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "agent.local_owner.ended",
        metadata: { instanceId: INSTANCE_ID, runId: RUN_ID },
      }),
    );
    expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
  });

  it.each([
    { failure: "alive" },
    { failure: "unreadable" },
    { failure: "workers" },
    { failure: "write_failed" },
  ] as const)("keeps the owner uncertain on $failure", async ({ failure }) => {
    mocks.ownership.hasEndedLocalOwner.mockResolvedValue(failure !== "alive");
    if (failure === "unreadable")
      mocks.ownership.hasEndedLocalOwner.mockRejectedValue(
        new Error("private path"),
      );
    if (failure === "workers") worker.settle.mockResolvedValue(1);
    if (failure === "write_failed")
      mocks.owners.released.mockRejectedValue(new Error("database down"));
    const sessions = createSessions();

    await adopt(sessions);

    expect(sessions.unverified()).toEqual(new Set([INSTANCE_ID]));
    expect(sessions.hasEnded(INSTANCE_ID)).toBe(false);
    expect(mocks.logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.local_owner.unverified" }),
    );
    expect(mocks.transport.sendLocalCommand).not.toHaveBeenCalled();
  });
});
