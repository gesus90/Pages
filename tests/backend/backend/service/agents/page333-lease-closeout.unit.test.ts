import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LocalControlCommandError } from "@/backend/agents/local/LocalControlFailure";

import { nativeSession, owner, resourceWorld } from "./page81-resource-fixture";

const boundary = vi.hoisted(() => ({
  settle: vi.fn<() => Promise<boolean | null>>(),
  ended: vi.fn<() => Promise<boolean>>(),
  running: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({ settleManagedLocalOwner: boundary.settle, inspectManagedLocalOwner: () => "owned" }));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({ hasEndedOwnedNamespace: boundary.ended }));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({ hasRunningWorkerUnit: boundary.running, settleWorkerUnits: vi.fn(async () => 0) }));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/logging/Logger")>()),
  logEvent: vi.fn(), logCaughtError: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  boundary.settle.mockReset().mockRejectedValue(new LocalControlCommandError("internal"));
  boundary.ended.mockReset().mockResolvedValue(true);
  boundary.running.mockReset().mockResolvedValue(false);
});
afterEach(() => { vi.useRealTimers(); });

it.each(["ended", "process_alive", "worker_alive", "unreadable"])("reconciles the plan lease after an owner close error when evidence is %s", async (evidence) => {
  const world = resourceWorld();
  await world.scheduler.recover();
  if (evidence === "process_alive") boundary.ended.mockResolvedValue(false);
  if (evidence === "worker_alive") boundary.running.mockResolvedValue(true);
  if (evidence === "unreadable") boundary.running.mockRejectedValue(new Error("unavailable"));
  const native = nativeSession();
  native.close.mockRejectedValue(new LocalControlCommandError("plan_history_unavailable"));
  const session = await world.scheduler.open(owner("a"), new AbortController().signal, async () => native);
  await world.scheduler.registerNamespace("a", { pid: 42, uid: 1000, start: 12, boot: "11111111-1111-4111-8111-111111111111" });
  try {
    await expect(session.close()).rejects.toMatchObject({ code: "plan_local_control_failed" });
    if (evidence === "ended") {
      expect(world.records.has("a")).toBe(false);
      expect(world.scheduler.snapshot().active).toEqual([]);
    } else {
      expect(world.records.get("a")?.state).toBe("cleanup_failed");
      expect(world.store.remove).not.toHaveBeenCalled();
    }
    expect(world.cleanup).not.toHaveBeenCalled();
  } finally { await world.scheduler.shutdown(); }
});
