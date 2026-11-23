import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import {
  captureOwnedNamespace,
  forceOwnedNamespace,
  hasEndedOwnedNamespace,
  previousBootNamespaceState,
  settleOwnedNamespace,
} from "@/backend/agents/cli/CliOwnedNamespace";

import type { AcpNamespaceOwner } from "@/definition/AcpResource";

const mocks = vi.hoisted(() => ({
  settleManagedLocalOwner: vi.fn(),
  hasRunningWorkerUnit: vi.fn(),
  stopWorkerUnits: vi.fn(),
  wait: vi.fn(),
}));

vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({
  settleManagedLocalOwner: mocks.settleManagedLocalOwner,
}));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  hasRunningWorkerUnit: mocks.hasRunningWorkerUnit,
  stopWorkerUnits: mocks.stopWorkerUnits,
}));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.wait }));

/** Builds a deliberately partial test double typed as the parameter it replaces. */
function stub<T>(value: unknown): T {
  return value as T;
}

const BOOT = "11111111-1111-4111-8111-111111111111";
const OTHER_BOOT = "22222222-2222-4222-8222-222222222222";
const uid = process.getuid?.() ?? 0;
let root = "";

async function writeBoot(value: string): Promise<void> {
  await mkdir(path.join(root, "sys/kernel/random"), { recursive: true });
  await writeFile(path.join(root, "sys/kernel/random/boot_id"), `${value}\n`);
}

async function writeProcess(pid: number, start: string): Promise<void> {
  await mkdir(path.join(root, String(pid)), { recursive: true });
  const fields = ["S", ...Array.from({ length: 18 }, () => "0"), start];
  await writeFile(
    path.join(root, String(pid), "stat"),
    `${pid} (a b) ${fields.join(" ")} 0 0\n`,
  );
}

const invalidOwner = stub<AcpNamespaceOwner>({ pid: 0 });

function owner(overrides: Partial<AcpNamespaceOwner> = {}): AcpNamespaceOwner {
  return { pid: 4242, uid, start: 77, boot: BOOT, ...overrides };
}

beforeEach(async () => {
  const parent = pagesTempDirectory("cli-owned-namespace-test");
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, "proc-"));
  await writeBoot(BOOT);
  mocks.settleManagedLocalOwner.mockResolvedValue(null);
  mocks.hasRunningWorkerUnit.mockResolvedValue(false);
  mocks.wait.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("captures the identity of a live supervisor", async () => {
  await writeProcess(4242, "77");
  expect(await captureOwnedNamespace(4242, root)).toEqual(owner());
});

it.each([0, -1, 1.5, Number.NaN])("refuses the PID %s", async (pid) => {
  await expect(captureOwnedNamespace(pid, root)).rejects.toThrow(
    "Invalid supervisor PID",
  );
});

it("refuses a capture without getuid", async () => {
  const original = process.getuid;
  Object.defineProperty(process, "getuid", {
    value: undefined,
    configurable: true,
  });
  try {
    await expect(captureOwnedNamespace(4242, root)).rejects.toThrow(
      "Invalid supervisor PID",
    );
  } finally {
    Object.defineProperty(process, "getuid", {
      value: original,
      configurable: true,
    });
  }
});

it("refuses a capture of a missing or foreign supervisor", async () => {
  await expect(captureOwnedNamespace(4242, root)).rejects.toThrow(
    "Supervisor identity unavailable",
  );
  await writeProcess(4242, "77");
  vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
  await expect(captureOwnedNamespace(4242, root)).rejects.toThrow(
    "Supervisor identity unavailable",
  );
});

it.each(["abc", "-1", "1.5"])(
  "refuses the invalid start time %s",
  async (start) => {
    await writeProcess(4242, start);
    await expect(captureOwnedNamespace(4242, root)).rejects.toThrow(
      "Invalid process identity",
    );
  },
);

it("refuses a malformed boot identity", async () => {
  await writeBoot("not-a-boot-id");
  await writeProcess(4242, "77");
  await expect(captureOwnedNamespace(4242, root)).rejects.toThrow(
    "Invalid boot identity",
  );
});

it("reports the state of a supervisor across boots", async () => {
  expect(await previousBootNamespaceState(owner(), root)).toBe("current");
  expect(
    await previousBootNamespaceState(owner({ boot: OTHER_BOOT }), root),
  ).toBe("dead");
  await writeProcess(4242, "1");
  expect(
    await previousBootNamespaceState(owner({ boot: OTHER_BOOT }), root),
  ).toBe("alive");
});

it("rejects stored metadata that is not a valid owner", async () => {
  await expect(
    previousBootNamespaceState(invalidOwner, root),
  ).rejects.toThrow();
  await expect(hasEndedOwnedNamespace(invalidOwner, root)).rejects.toThrow();
  await expect(settleOwnedNamespace(invalidOwner, "i", root)).rejects.toThrow();
});

it("detects an ended supervisor by boot, absence, uid and start", async () => {
  expect(await hasEndedOwnedNamespace(owner({ boot: OTHER_BOOT }), root)).toBe(
    true,
  );
  expect(await hasEndedOwnedNamespace(owner(), root)).toBe(true);
  await writeProcess(4242, "77");
  expect(await hasEndedOwnedNamespace(owner(), root)).toBe(false);
  expect(await hasEndedOwnedNamespace(owner({ uid: uid + 1 }), root)).toBe(
    true,
  );
  expect(await hasEndedOwnedNamespace(owner({ start: 78 }), root)).toBe(true);
});

it("settles through the service manager when it knows the owner", async () => {
  await writeProcess(4242, "77");
  mocks.settleManagedLocalOwner.mockResolvedValueOnce(false);
  expect(await settleOwnedNamespace(owner(), "inst", root)).toBe(false);
  mocks.settleManagedLocalOwner.mockResolvedValueOnce(true);
  expect(await settleOwnedNamespace(owner(), "inst", root)).toBe(false);
  await rm(path.join(root, "4242"), { recursive: true });
  mocks.settleManagedLocalOwner.mockResolvedValueOnce(true);
  expect(await settleOwnedNamespace(owner(), "inst", root)).toBe(true);
});

it.each(["other-inst-aaaaaaaa.service", "pages-acp-inst-xyz.service"])(
  "refuses the foreign unit %s",
  async (unit) => {
    await expect(
      settleOwnedNamespace(owner({ unit }), "inst", root),
    ).rejects.toThrow("Invalid owned worker unit");
  },
);

it("stops the units of a session on the same boot", async () => {
  const unit = "pages-acp-inst-0123abcd.service";
  mocks.hasRunningWorkerUnit.mockResolvedValueOnce(true);
  expect(await settleOwnedNamespace(owner({ unit }), "inst", root)).toBe(false);
  expect(mocks.stopWorkerUnits).toHaveBeenCalledWith("inst");
  expect(await settleOwnedNamespace(owner({ unit }), "inst", root)).toBe(true);
});

it("skips the unit check for a unit of another boot or without a unit", async () => {
  expect(
    await settleOwnedNamespace(
      owner({ unit: "bad", boot: OTHER_BOOT }),
      "inst",
      root,
    ),
  ).toBe(true);
  expect(mocks.stopWorkerUnits).not.toHaveBeenCalled();
});

it("does not force a settled, unit-owned or own-process supervisor", async () => {
  expect(
    await forceOwnedNamespace(owner({ boot: OTHER_BOOT }), "i", root),
  ).toBe(true);
  mocks.hasRunningWorkerUnit.mockResolvedValue(true);
  expect(
    await forceOwnedNamespace(
      owner({ unit: "pages-acp-i-0123abcd.service" }),
      "i",
      root,
    ),
  ).toBe(false);
  await writeProcess(process.pid, "77");
  expect(
    await forceOwnedNamespace(owner({ pid: process.pid }), "i", root),
  ).toBe(false);
});

it("kills a lingering supervisor and waits until it ends", async () => {
  await writeProcess(4242, "77");
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  mocks.wait.mockImplementationOnce(async () => {
    await rm(path.join(root, "4242"), { recursive: true });
  });
  expect(await forceOwnedNamespace(owner(), "i", root)).toBe(true);
  expect(kill).toHaveBeenCalledWith(4242, "SIGKILL");
  expect(mocks.wait).toHaveBeenCalledWith(25);
});

it("gives up after twenty checks of a supervisor that stays alive", async () => {
  await writeProcess(4242, "77");
  vi.spyOn(process, "kill").mockImplementation(() => true);
  expect(await forceOwnedNamespace(owner(), "i", root)).toBe(false);
  expect(mocks.wait).toHaveBeenCalledTimes(20);
});

it("tolerates a supervisor that vanishes before the signal", async () => {
  await writeProcess(4242, "77");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  expect(await forceOwnedNamespace(owner(), "i", root)).toBe(false);
});

it("passes on any other signalling error", async () => {
  await writeProcess(4242, "77");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  await expect(forceOwnedNamespace(owner(), "i", root)).rejects.toThrow(
    "denied",
  );
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw "plain";
  });
  await expect(forceOwnedNamespace(owner(), "i", root)).rejects.toBe("plain");
});

it("reports a supervisor that ended while the manager was settling", async () => {
  mocks.settleManagedLocalOwner.mockResolvedValueOnce(false);
  const kill = vi.spyOn(process, "kill");
  expect(await forceOwnedNamespace(owner(), "i", root)).toBe(true);
  expect(kill).not.toHaveBeenCalled();
});
