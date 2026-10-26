import { readdir, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { identity, readRecord } from "./journal.mjs";

async function ownedProcesses(marker) {
  const owned = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if ((await stat(`/proc/${entry}`)).uid !== process.getuid()) continue;
      const environment = await readFile(`/proc/${entry}/environ`, "utf8");
      if (environment.split("\0").includes(`PAGES_REMOTE_JOB=${marker}`))
        owned.push(Number(entry));
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return owned;
}

/** Counts every task (thread) of this account, which is what RLIMIT_NPROC limits. */
export async function accountTasks() {
  let count = 0;
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = await readFile(`/proc/${entry}/status`, "utf8");
      if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== process.getuid())
        continue;
      count += Number(/^Threads:\s+(\d+)/m.exec(status)?.[1] ?? 1);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return count;
}

/** Terminates only this attempt's identity-bound process group and marked descendants. */
export async function cleanup(folder, jobId) {
  const child = await readRecord(join(folder, "child.json"));
  if (child && (await identity(child.processId)) === child.identity) {
    try {
      process.kill(-child.processId, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const owned = await ownedProcesses(jobId);
  const identities = new Map(
    await Promise.all(owned.map(async (pid) => [pid, await identity(pid)])),
  );
  for (const pid of owned) {
    if (!identities.get(pid) || (await identity(pid)) !== identities.get(pid))
      continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && (await ownedProcesses(jobId)).length)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (child && (await identity(child.processId)) === child.identity) {
    try {
      process.kill(-child.processId, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  for (const pid of await ownedProcesses(jobId)) {
    const expected = await identity(pid);
    if (!expected || (await identity(pid)) !== expected) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const remaining = await ownedProcesses(jobId);
  const alive = await Promise.all(remaining.map(identity));
  if (alive.some(Boolean)) return "failed";
  await rm(join(folder, "runtime"), { recursive: true, force: true });
  return "confirmed";
}
