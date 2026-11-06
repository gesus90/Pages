import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import {
  localOwnerManifestSchema,
  localOwnerProofSchema,
} from "./LocalSessionContracts";
import { readLocalRecord } from "./LocalSessionFiles";

import type {
  LocalOwnerManifest,
  LocalOwnerProof,
} from "./LocalSessionContracts";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

const runFile = promisify(execFile);

/** Uses only the server account's manager, never inherited agent bus settings. */
export function localManagerEnvironment(): Record<string, string> {
  const runtime = `/run/user/${process.getuid?.()}`;
  return {
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
  };
}

/** Hashes the exact private startup record; secrets themselves never enter the database. */
export function localManifestDigest(manifest: LocalOwnerManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

/** Captures the actual process identity without reading any process environment. */
export async function captureLocalOwner(
  manifest: LocalOwnerManifest,
): Promise<LocalOwnerProof> {
  const pid = process.pid;
  const identity = await readIdentity(pid);
  const argumentsText = await readFile(`/proc/${pid}/cmdline`, "utf8");
  const invocationId = process.env.INVOCATION_ID;
  return localOwnerProofSchema.parse({
    instanceKey: manifest.instanceKey,
    instanceId: manifest.launch.instanceId,
    runId: manifest.launch.runId,
    stepId: manifest.launch.stepId,
    attemptId: manifest.launch.attemptId,
    unit: manifest.unit,
    invocationId,
    ...identity,
    pid,
    arguments: argumentsText.split("\0").filter(Boolean),
  });
}

/** Refuses every mismatch before adoption or IPC control; no PID or unit is signalled here. */
export async function proveLocalOwner(
  entry: LocalSessionEntry,
  directory: string,
): Promise<{
  readonly manifest: LocalOwnerManifest;
  readonly proof: LocalOwnerProof;
}> {
  const manifest = localOwnerManifestSchema.parse(
    await readLocalRecord(path.join(directory, "manifest.json")),
  );
  const proof = localOwnerProofSchema.parse(
    await readLocalRecord(path.join(directory, "proof.json")),
  );
  if (manifest.directory !== directory)
    throw new Error("Local owner directory binding mismatch");
  requireLaunchBinding(entry, manifest);
  requireProofBinding(entry, manifest, proof);
  await requireProcessBinding(manifest, proof);
  await requireUnitBinding(manifest, proof);
  return { manifest, proof };
}

function requireLaunchBinding(
  entry: LocalSessionEntry,
  manifest: LocalOwnerManifest,
): void {
  if (
    localManifestDigest(manifest) !== entry.manifestDigest ||
    manifest.instanceKey !== entry.instanceKey ||
    manifest.launch.instanceId !== entry.instanceId ||
    manifest.launch.runId !== entry.runId ||
    manifest.launch.stepId !== entry.stepId ||
    manifest.launch.attemptId !== entry.attemptId
  )
    throw new Error("Local owner launch binding mismatch");
}

function requireProofBinding(
  entry: LocalSessionEntry,
  manifest: LocalOwnerManifest,
  proof: LocalOwnerProof,
): void {
  if (entry.proof && JSON.stringify(entry.proof) !== JSON.stringify(proof))
    throw new Error("Local owner invocation changed");
  if (
    proof.instanceKey !== entry.instanceKey ||
    proof.instanceId !== entry.instanceId ||
    proof.runId !== entry.runId ||
    proof.stepId !== entry.stepId ||
    proof.attemptId !== entry.attemptId ||
    proof.unit !== manifest.unit
  )
    throw new Error("Local owner proof binding mismatch");
}

async function requireProcessBinding(
  manifest: LocalOwnerManifest,
  proof: LocalOwnerProof,
): Promise<void> {
  const identity = await readIdentity(proof.pid);
  if (
    identity.uid !== proof.uid ||
    identity.uid !== process.getuid?.() ||
    identity.start !== proof.start ||
    identity.boot !== proof.boot ||
    identity.cgroup !== proof.cgroup
  )
    throw new Error("Local owner process identity changed");
  const argumentsText = await readFile(`/proc/${proof.pid}/cmdline`);
  const argumentsList = argumentsText
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (
    JSON.stringify(argumentsList) !== JSON.stringify(proof.arguments) ||
    !argumentsList.includes(manifest.directory) ||
    !argumentsList.includes(manifest.configPath)
  )
    throw new Error("Local owner command binding mismatch");
}

async function requireUnitBinding(
  manifest: LocalOwnerManifest,
  proof: LocalOwnerProof,
): Promise<void> {
  const shown = await runFile(
    "/usr/bin/systemctl",
    [
      "--user",
      "show",
      manifest.unit,
      "--property=MainPID,InvocationID,ControlGroup,ActiveState",
    ],
    { env: localManagerEnvironment(), timeout: 10_000 },
  );
  const properties = new Map(
    shown.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  if (
    properties.get("MainPID") !== String(proof.pid) ||
    properties.get("InvocationID") !== proof.invocationId ||
    properties.get("ControlGroup") !== proof.cgroup ||
    properties.get("ActiveState") !== "active"
  )
    throw new Error("Local owner unit identity changed");
}

async function readIdentity(pid: number): Promise<{
  readonly uid: number;
  readonly start: number;
  readonly boot: string;
  readonly cgroup: string;
}> {
  const [metadata, line, boot, cgroups] = await Promise.all([
    stat(`/proc/${pid}`),
    readFile(`/proc/${pid}/stat`, "utf8"),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    readFile(`/proc/${pid}/cgroup`, "utf8"),
  ]);
  const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
  const start = Number(fields[19]);
  if (fields[0] === "Z" || !Number.isSafeInteger(start))
    throw new Error("Local owner process is not live");
  const cgroup = cgroups
    .trim()
    .split("\n")
    .find((entry) => entry.startsWith("0::"))
    ?.slice(3);
  if (!cgroup) throw new Error("Local owner cgroup is unavailable");
  return { uid: metadata.uid, start, boot: boot.trim(), cgroup };
}
