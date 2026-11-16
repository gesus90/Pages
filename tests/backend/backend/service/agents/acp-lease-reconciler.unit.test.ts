import { describe, expect, it, vi } from "vitest";

import { AcpLeaseReconciler } from "@/backend/service/agents/AcpLeaseReconciler";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AcpLeaseReconcilerHost } from "@/backend/service/agents/AcpLeaseReconciler";
import type { AcpResourceRecord } from "@/definition/AcpResource";

const closeLease = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/resources/AcpLeaseProcesses", () => ({
  closeLease,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const record: AcpResourceRecord = {
  instanceId: "i",
  userId: "u",
  provider: "codex_cli",
  runId: null,
  stepId: null,
  state: "cleanup_failed",
  since: "now",
};

function fixture(): {
  reconciler: AcpLeaseReconciler;
  host: AcpLeaseReconcilerHost;
} {
  const host = partial<AcpLeaseReconcilerHost>({
    active: new Map(),
    sessions: new Map(),
    store: partial({ save: vi.fn().mockResolvedValue(undefined) }),
    unverifiedLocal: () => new Set(),
    cleanup: vi.fn(),
    persist: async (task) => task(),
    transition: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(true),
  });
  return { reconciler: new AcpLeaseReconciler(host), host };
}

describe("ACP lease reconciliation", () => {
  it("preserves, retains and recovers startup leases", async () => {
    const { reconciler, host } = fixture();
    closeLease.mockResolvedValue({ remaining: 0 });
    await reconciler.recoverStartup(
      [
        record,
        { ...record, instanceId: "retained" },
        { ...record, instanceId: "recover" },
      ],
      [{ ...record, instanceId: "legacy" }],
      { preserved: new Set(["i"]), retained: new Set(["retained"]) },
    );
    expect(host.transition).toHaveBeenCalledWith("i", "running");
    expect(host.transition).toHaveBeenCalledWith("retained", "cleanup_failed");
    expect(host.finish).toHaveBeenCalledWith("recover", true);
    expect(host.finish).toHaveBeenCalledWith("legacy", true);
    expect(host.store.save).toHaveBeenCalledOnce();
  });

  it("refuses unverified owners and checks only matching uncertain leases", async () => {
    const { reconciler, host } = fixture();
    host.active.set("i", record);
    host.active.set("other", {
      ...record,
      instanceId: "other",
      runId: "other",
    });
    closeLease.mockResolvedValue({ remaining: 1 });
    vi.mocked(host.finish).mockResolvedValue(false);
    await expect(reconciler.reconcile("other")).resolves.toBe(1);
    expect(host.finish).toHaveBeenCalledWith("other", false);
    const guarded = new AcpLeaseReconciler({
      ...host,
      unverifiedLocal: () => new Set(["i"]),
    });
    await expect(guarded.cleanupRecord(record, "now")).rejects.toThrow(
      "unverified",
    );
    await expect(guarded.reconcile()).resolves.toBe(2);
  });

  it("settles only chat leases and tolerates absent ones", async () => {
    const { reconciler, host } = fixture();
    await expect(reconciler.settleChatLease("missing")).resolves.toBe(true);
    host.active.set("plan", { ...record, runId: "run" });
    await expect(reconciler.settleChatLease("plan")).resolves.toBe(false);
    host.active.set("i", record);
    closeLease
      .mockResolvedValueOnce({ remaining: 0 })
      .mockResolvedValueOnce({ remaining: 1 });
    await expect(reconciler.settleChatLease("i")).resolves.toBe(true);
    await expect(reconciler.settleChatLease("i")).resolves.toBe(false);
  });
});
