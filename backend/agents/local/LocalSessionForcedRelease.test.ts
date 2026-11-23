import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { forgetForcedLocalRun } from "@/backend/agents/local/LocalSessionForcedRelease";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

const logCaughtError = vi.hoisted(() => vi.fn());
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError }));

/** The release only reads the run, instance and release time of an entry. */
function double<Contract>(value: object): Contract {
  return value as unknown as Contract;
}

function entry(
  instanceId: string,
  runId: string,
  releasedAt: string | null = null,
): LocalSessionEntry {
  return double<LocalSessionEntry>({ instanceId, runId, releasedAt });
}

interface TestContext {
  readonly detach: Mock;
  readonly attached: Map<string, { session: { detach?: () => void } }>;
  readonly entries: Map<string, LocalSessionEntry>;
  readonly proven: Set<string>;
  readonly uncertain: Set<string>;
  readonly release: Mock<(item: LocalSessionEntry) => Promise<void>>;
}

function context(entries: readonly LocalSessionEntry[]): TestContext {
  const detach = vi.fn();
  const attached = new Map([
    ["failing", { session: { detach } }],
    ["bare", { session: {} }],
  ]);
  return {
    detach,
    attached,
    entries: new Map(entries.map((item) => [item.instanceId, item])),
    proven: new Set(["failing", "bare", "ok"]),
    uncertain: new Set(["failing", "bare", "ok", "other"]),
    release: vi.fn<(item: LocalSessionEntry) => Promise<void>>(),
  };
}

it("releases matching entries and skips other runs and released ones", async () => {
  const state = context([
    entry("ok", "run"),
    entry("other", "elsewhere"),
    entry("done", "run", "2020-01-01T00:00:00.000Z"),
  ]);
  await forgetForcedLocalRun("run", state);
  expect(state.release).toHaveBeenCalledTimes(1);
  expect(state.uncertain.has("ok")).toBe(false);
  expect(state.uncertain.has("other")).toBe(true);
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("detaches and marks released an entry whose release fails", async () => {
  const state = context([entry("failing", "run"), entry("bare", "run")]);
  state.release.mockRejectedValue(new Error("boom"));
  await forgetForcedLocalRun("run", state);
  expect(logCaughtError).toHaveBeenCalledTimes(2);
  expect(state.detach).toHaveBeenCalledOnce();
  expect(state.attached.size).toBe(0);
  expect(state.entries.get("failing")?.releasedAt).toEqual(expect.any(String));
  expect(state.proven.has("failing")).toBe(false);
  expect(state.uncertain.has("failing")).toBe(false);
});

it("tolerates a failed release of an entry that was never attached", async () => {
  const state = context([entry("ghost", "run")]);
  state.release.mockRejectedValue(new Error("boom"));
  await forgetForcedLocalRun("run", state);
  expect(state.entries.get("ghost")?.releasedAt).toEqual(expect.any(String));
});
