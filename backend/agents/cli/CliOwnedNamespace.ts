import { readFile, stat } from "node:fs/promises";
import { readOwnedNamespace } from "@/definition/AcpNamespace";

import { stopWorkerUnits } from "./CliWorkerUnit";

import type { AcpNamespaceOwner } from "@/definition/AcpResource";

function vanished(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

async function bootId(root: string): Promise<string> {
  const value = (await readFile(`${root}/sys/kernel/random/boot_id`, "utf8"))
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9-]{36}$/u.test(value)) throw new Error("Invalid boot identity");
  return value;
}

async function processIdentity(
  pid: number,
  root: string,
): Promise<{ readonly uid: number; readonly start: number } | null> {
  try {
    const directory = `${root}/${pid}`;
    const [metadata, line] = await Promise.all([
      stat(directory),
      readFile(`${directory}/stat`, "utf8"),
    ]);
    const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
    const start = Number(fields[19]);
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error("Invalid process identity");
    return { uid: metadata.uid, start };
  } catch (error: unknown) {
    if (vanished(error)) return null;
    throw error;
  }
}

/** Captures only a PID returned by this server's own spawn. */
export async function captureOwnedNamespace(
  pid: number,
  root = "/proc",
): Promise<AcpNamespaceOwner> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.getuid === undefined)
    throw new Error("Invalid supervisor PID");
  const [identity, boot] = await Promise.all([
    processIdentity(pid, root),
    bootId(root),
  ]);
  if (!identity || identity.uid !== process.getuid())
    throw new Error("Supervisor identity unavailable");
  return { pid, ...identity, boot };
}

/** Checks a stored supervisor without reading any process environment or signalling a PID. */
export async function hasEndedOwnedNamespace(
  owner: AcpNamespaceOwner,
  root = "/proc",
): Promise<boolean> {
  readOwnedNamespace(owner);
  if ((await bootId(root)) !== owner.boot) return true;
  const current = await processIdentity(owner.pid, root);
  return (
    current === null ||
    current.uid !== owner.uid ||
    current.start !== owner.start
  );
}

/** Settles a recorded owned unit before checking its directly spawned supervisor. */
export async function settleOwnedNamespace(
  owner: AcpNamespaceOwner,
  instanceId: string,
  root = "/proc",
): Promise<boolean> {
  readOwnedNamespace(owner);
  if (owner.unit && (await bootId(root)) === owner.boot) {
    const prefix = `pages-acp-${instanceId}-`;
    if (
      !owner.unit.startsWith(prefix) ||
      !/^[a-f0-9]{8}\.service$/u.test(owner.unit.slice(prefix.length))
    )
      throw new Error("Invalid owned worker unit");
    await stopWorkerUnits(instanceId);
  }
  return hasEndedOwnedNamespace(owner, root);
}
