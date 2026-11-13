import { beforeEach, expect, it, vi } from "vitest";

import {
  hasEndedLocalOwner,
  localManifestDigest,
} from "@/backend/agents/local/LocalSessionOwnership";

import { MANIFEST, PROOF, entryOf } from "./local-sessions-fixture";

const boundary = vi.hoisted(() => ({
  command: vi.fn<() => Promise<{ stdout: string }>>(),
  record: vi.fn<(file: string) => Promise<unknown>>(),
  read: vi.fn<(file: string) => Promise<string>>(),
  stat: vi.fn<() => Promise<{ uid: number }>>(),
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: boundary.command }) };
});
vi.mock("node:fs/promises", () => ({ readFile: boundary.read, stat: boundary.stat }));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({ readLocalRecord: boundary.record }));

const proof = { ...PROOF, instanceKey: MANIFEST.instanceKey };
const entry = entryOf({
  instanceKey: MANIFEST.instanceKey,
  manifestDigest: localManifestDigest(MANIFEST),
  proof,
});

beforeEach(() => {
  vi.resetAllMocks();
  boundary.command.mockResolvedValue({ stdout: "LoadState=loaded\nActiveState=inactive\n" });
  boundary.record.mockImplementation(async (file) => file.endsWith("manifest.json") ? MANIFEST : proof);
  boundary.stat.mockResolvedValue({ uid: proof.uid });
  boundary.read.mockImplementation(async (file) => {
    if (file.endsWith("boot_id")) return proof.boot;
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  });
});

it.each(["inactive", "unloaded"])("proves a dead owner when its unit is %s and its exact process is gone", async (unit) => {
  if (unit === "unloaded") boundary.command.mockResolvedValue({ stdout: "LoadState=not-found\nActiveState=inactive\n" });
  await expect(hasEndedLocalOwner(entry, MANIFEST.directory)).resolves.toBe(true);
  expect(boundary.command).toHaveBeenCalledOnce();
  expect(boundary.read).toHaveBeenCalledWith(`/proc/${proof.pid}/stat`, "utf8");
});

it.each([proof.start, proof.start + 1])("compares start time %s even when the PID still exists", async (start) => {
  const fields = ["S", ...Array<string>(18).fill("0"), String(start)];
  boundary.read.mockImplementation(async (file) => file.endsWith("boot_id") ? proof.boot : `${proof.pid} (owner) ${fields.join(" ")}`);
  await expect(hasEndedLocalOwner(entry, MANIFEST.directory)).resolves.toBe(start !== proof.start);
});

it.each(["active", "activating", "deactivating", "unknown"])("retains an owner while unit state %s cannot prove its end", async (state) => {
  boundary.command.mockResolvedValue({ stdout: `LoadState=loaded\nActiveState=${state}\n` });
  await expect(hasEndedLocalOwner(entry, MANIFEST.directory)).resolves.toBe(false);
  expect(boundary.read).not.toHaveBeenCalled();
});

it.each(["missing_proof", "denied_proc", "denied_unit", "binding_changed"])("refuses cleanup for %s evidence", async (failure) => {
  if (failure === "missing_proof") boundary.record.mockImplementation(async (file) => {
    if (file.endsWith("manifest.json")) return MANIFEST;
    throw Object.assign(new Error("unreadable private path"), { code: "ENOENT" });
  });
  if (failure === "denied_proc") boundary.stat.mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
  if (failure === "denied_unit") boundary.command.mockRejectedValue(new Error("bus unavailable"));
  const current = failure === "binding_changed" ? { ...entry, manifestDigest: "changed" } : entry;
  await expect(hasEndedLocalOwner(current, MANIFEST.directory)).rejects.toBeInstanceOf(Error);
});
