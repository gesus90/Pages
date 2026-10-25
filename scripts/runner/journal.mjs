import { randomUUID } from "node:crypto";
import { open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

/** Writes and syncs private state before exposing it to the transport. */
export async function store(destination, contents) {
  const pending = `${destination}.${randomUUID()}`;
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

/** Binds process ownership to Linux start time, avoiding PID reuse. */
export async function identity(pid) {
  try {
    const contents = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = contents.slice(contents.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}
