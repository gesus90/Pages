import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";

/** Writes and syncs private state before exposing it to the transport. */
export async function store(destination, contents) {
  const pending = `${destination}.${randomUUID()}`;
  try {
    const handle = await open(pending, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(contents));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pending, destination);
    const parent = await open(join(destination, ".."), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    try {
      await rm(pending, { force: true });
    } catch {
      console.error("Runner journal temporary file cleanup failed.");
    }
    throw error;
  }
}

/** Missing records are distinct from malformed or inaccessible records. */
export async function readRecord(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("Private runner record unreadable");
  }
}

/** Host-only launch identity, hidden from the job's mount namespace. */
export async function readOwnedLaunch(folder) {
  const job = basename(folder);
  if (!/^[a-f0-9-]{36}$/.test(job))
    throw new Error("Invalid runner ownership path");
  return readRecord(join(folder, "..", "..", "ownership", `${job}.json`));
}

/** Binds process ownership to Linux start time, avoiding PID reuse. */
export async function identity(pid) {
  try {
    const contents = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = contents.slice(contents.lastIndexOf(")") + 2).split(" ");
    const boot = (
      await readFile("/proc/sys/kernel/random/boot_id", "utf8")
    ).trim();
    return ["Z", "X"].includes(fields[0]) ? null : `${boot}:${fields[19]}`;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}
