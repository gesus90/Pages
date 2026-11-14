import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localManifestDigest,
  proveLocalOwner,
} from "@/backend/agents/local/LocalSessionOwnership";
import { LocalAttachedSession } from "@/backend/agents/local/LocalAttachedSession";

import { LAUNCH, MANIFEST, entryOf, stub } from "./local-sessions-fixture";
import { GOOD_TURN } from "./local-owner-session-fixture";
import {
  OWNER_PROOF,
  boundaries,
  identity,
  resetOwnerEvidence,
  unitResponse,
} from "./page342-ownership-fixture";

import type { LocalSessionCommand } from "@/backend/agents/local/LocalSessionContracts";

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const fixture = await import("./page342-ownership-fixture");
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, {
    value: fixture.boundaries.show,
  });
  return { execFile };
});
vi.mock("node:fs/promises", async () => {
  const fixture = await import("./page342-ownership-fixture");
  return {
    readFile: fixture.boundaries.readFile,
    stat: fixture.boundaries.stat,
  };
});
vi.mock("@/backend/agents/local/LocalSessionFiles", async () => ({
  readLocalRecord: (await import("./page342-ownership-fixture")).boundaries
    .record,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

interface ProofOutcome {
  readonly result?: Awaited<ReturnType<typeof proveLocalOwner>>;
  readonly error?: unknown;
}

/** Observes both outcomes before advancing fake time, so rejections never leak. */
async function verifyOwner(): Promise<ProofOutcome> {
  const entry = entryOf({
    instanceKey: MANIFEST.instanceKey,
    manifestDigest: localManifestDigest(MANIFEST),
    proof: OWNER_PROOF,
  });
  const outcome = proveLocalOwner(entry, MANIFEST.directory).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetOwnerEvidence();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("PAGE-342: ownership across a user-manager reexec", () => {
  it("keeps the actual pending turn attached when a journal-read proof survives reexec", async () => {
    const entry = entryOf({
      instanceKey: MANIFEST.instanceKey,
      manifestDigest: localManifestDigest(MANIFEST),
      proof: OWNER_PROOF,
    });
    let hasReadTurn = false;
    const control = vi.fn(
      async (command: LocalSessionCommand): Promise<unknown> => {
        await proveLocalOwner(entry, MANIFEST.directory);
        if (command.kind !== "read") return {};
        if (hasReadTurn) return { records: [] };
        hasReadTurn = true;
        return {
          records: [
            {
              sequence: 1,
              previousDigest: "",
              payload: "turn",
              digest: "a".repeat(64),
            },
          ],
        };
      },
    );
    const session = new LocalAttachedSession(
      LAUNCH,
      new AbortController().signal,
      { started: vi.fn(), identified: vi.fn() },
      {
        importer: stub({
          restore: async () => [],
          acknowledgement: { sequence: 0, digest: "" },
          cursor: 0,
          take: async () => ({
            kind: "turn",
            turnId: LAUNCH.turnId,
            result: GOOD_TURN,
          }),
        }),
        control,
        completion: async () => null,
        nextLaunch: () => LAUNCH,
        namespace: async () => undefined,
      },
    );
    boundaries.show.mockRejectedValueOnce(
      new Error("User manager is reexecuting"),
    );
    try {
      const attaching = session.attach();
      await vi.advanceTimersByTimeAsync(250);
      await attaching;

      await expect(session.turn).resolves.toEqual(GOOD_TURN);
      expect(session.isDetached).toBe(false);
      expect(control.mock.calls.map(([command]) => command.kind)).toEqual([
        "read",
        "ack",
      ]);
    } finally {
      session.detach();
    }
  });
});

describe("PAGE-342: owner proof across a user-manager reexec", () => {
  it("accepts a matching process and unit without any retry", async () => {
    await expect(verifyOwner()).resolves.toEqual({
      result: { manifest: MANIFEST, proof: OWNER_PROOF },
    });
    expect(boundaries.show).toHaveBeenCalledOnce();
  });

  it.each(["ECONNRESET", "ETIMEDOUT"])(
    "rechecks the same owner after a transient %s from systemctl",
    async (code) => {
      boundaries.show.mockRejectedValueOnce(
        Object.assign(new Error("User manager is reexecuting"), { code }),
      );

      await expect(verifyOwner()).resolves.toEqual({
        result: { manifest: MANIFEST, proof: OWNER_PROOF },
      });
      expect(boundaries.show.mock.calls.length).toBeGreaterThan(1);
      for (const [program, args] of boundaries.show.mock.calls) {
        expect(program).toBe("/usr/bin/systemctl");
        expect(args).toEqual([
          "--user",
          "show",
          MANIFEST.unit,
          "--property=MainPID,InvocationID,ControlGroup,ActiveState",
        ]);
      }
    },
  );

  it("rejects a persistent manager outage with finite work and no owner proof", async () => {
    boundaries.show.mockRejectedValue(
      Object.assign(new Error("User manager remains unavailable"), {
        code: "ECONNRESET",
      }),
    );

    const outcome = await verifyOwner();

    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.result).toBeUndefined();
    expect(boundaries.show).toHaveBeenCalledTimes(3);
    for (const [, , options] of boundaries.show.mock.calls)
      expect(options).toMatchObject({ timeout: 2_000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["MainPID", "9999"],
    ["InvocationID", "d".repeat(32)],
    ["ControlGroup", "/user.slice/another-owner"],
    ["ActiveState", "inactive"],
  ])("rejects conflicting unit evidence %s", async (property, content) => {
    boundaries.show.mockResolvedValue(unitResponse({ [property]: content }));

    await expect(verifyOwner()).resolves.toMatchObject({
      error: { message: "Local owner unit identity changed" },
    });
    expect(boundaries.show).toHaveBeenCalledOnce();
  });

  it("rejects a replacement invocation when the manager becomes readable again", async () => {
    boundaries.show
      .mockRejectedValueOnce(
        Object.assign(new Error("User manager is reexecuting"), {
          code: "ECONNRESET",
        }),
      )
      .mockResolvedValue(unitResponse({ InvocationID: "d".repeat(32) }));

    await expect(verifyOwner()).resolves.toMatchObject({
      error: { message: "Local owner unit identity changed" },
    });
  });

  it("rejects a reused PID instead of trusting process evidence from before the outage", async () => {
    boundaries.show.mockImplementationOnce(async () => {
      identity.start += 1;
      throw Object.assign(new Error("User manager is reexecuting"), {
        code: "ECONNRESET",
      });
    });

    await expect(verifyOwner()).resolves.toMatchObject({
      error: { message: "Local owner process identity changed" },
    });
  });

  it("rechecks kernel identity after a successful unit read as well", async () => {
    boundaries.show.mockImplementationOnce(async () => {
      identity.start += 1;
      return unitResponse();
    });

    await expect(verifyOwner()).resolves.toMatchObject({
      error: { message: "Local owner process identity changed" },
    });
    expect(boundaries.show).toHaveBeenCalledOnce();
  });
});
