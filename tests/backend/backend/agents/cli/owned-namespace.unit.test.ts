import { beforeEach, expect, it, vi } from "vitest";

import {
  captureOwnedNamespace,
  hasEndedOwnedNamespace,
  settleOwnedNamespace,
} from "@/backend/agents/cli/CliOwnedNamespace";

const files = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  stopWorkerUnits: vi.fn(),
}));
vi.mock("node:fs/promises", () => files);
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  stopWorkerUnits: files.stopWorkerUnits,
}));

const BOOT = "10000000-0000-4000-8000-000000000001";
const OTHER_BOOT = "20000000-0000-4000-8000-000000000002";
const OWNER = { pid: 123, uid: 1000, start: 12345, boot: BOOT };

beforeEach(() => {
  files.readFile.mockReset();
  files.stat.mockReset().mockResolvedValue({ uid: OWNER.uid });
  files.stopWorkerUnits.mockReset().mockResolvedValue(0);
  files.readFile.mockImplementation(async (path: string) => {
    if (path.endsWith("boot_id")) return BOOT;
    if (path.endsWith("/stat"))
      return `123 (supervisor name) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${OWNER.start} 0`;
    throw new Error("Unexpected file");
  });
});

it("records only the spawned supervisor identity and boot", async () => {
  const owner = await captureOwnedNamespace(123, "/synthetic-proc");
  expect(owner).toEqual({ ...OWNER, uid: process.getuid?.() });
  expect(
    files.readFile.mock.calls.every(
      ([path]) => !String(path).includes("environ"),
    ),
  ).toBe(true);
});

it("keeps a matching live supervisor unconfirmed", async () => {
  await expect(hasEndedOwnedNamespace(OWNER, "/synthetic-proc")).resolves.toBe(
    false,
  );
});

it("confirms an earlier boot without consulting any PID", async () => {
  files.readFile.mockResolvedValueOnce(OTHER_BOOT);
  await expect(hasEndedOwnedNamespace(OWNER, "/synthetic-proc")).resolves.toBe(
    true,
  );
  expect(files.stat).not.toHaveBeenCalled();
});

it("detects PID reuse without signalling the replacement", async () => {
  files.stat.mockResolvedValue({ uid: OWNER.uid + 1 });
  const kill = vi.spyOn(process, "kill");
  await expect(hasEndedOwnedNamespace(OWNER, "/synthetic-proc")).resolves.toBe(
    true,
  );
  expect(kill).not.toHaveBeenCalled();
  kill.mockRestore();
});

it("keeps unreadable identity unconfirmed", async () => {
  files.stat.mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(
    hasEndedOwnedNamespace(OWNER, "/synthetic-proc"),
  ).rejects.toThrow("denied");
});

it("settles the recorded unit before confirming its supervisor is gone", async () => {
  files.stat.mockRejectedValue(
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );
  await expect(
    settleOwnedNamespace(
      { ...OWNER, unit: "pages-acp-owned-1234abcd.service" },
      "owned",
      "/synthetic-proc",
    ),
  ).resolves.toBe(true);
  expect(files.stopWorkerUnits).toHaveBeenCalledExactlyOnceWith("owned");
});

it("retains uncertainty when the recorded unit cannot be settled", async () => {
  files.stopWorkerUnits.mockRejectedValue(new Error("manager unavailable"));
  await expect(
    settleOwnedNamespace(
      { ...OWNER, unit: "pages-acp-owned-1234abcd.service" },
      "owned",
      "/synthetic-proc",
    ),
  ).rejects.toThrow("manager unavailable");
});

it("refuses a unit outside the session's own name", async () => {
  await expect(
    settleOwnedNamespace(
      { ...OWNER, unit: "pages-acp-other-1234abcd.service" },
      "owned",
      "/synthetic-proc",
    ),
  ).rejects.toThrow("Invalid owned worker unit");
  expect(files.stopWorkerUnits).not.toHaveBeenCalled();
});
