import { cleanupPagesFiles } from "./pages.mjs";
import { readdir, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { identity, readRecord, store } from "./journal.mjs";

export const STOP_TERM_MILLISECONDS = 2000;
export const STOP_KILL_MILLISECONDS = 3000;

function vanished(error) {
  return ["ENOENT", "ESRCH"].includes(error.code);
}

async function processRecord(pid) {
  const contents = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = contents.slice(contents.lastIndexOf(")") + 2).split(" ");
  return {
    pid,
    parent: Number(fields[1]),
    group: Number(fields[2]),
    start: await identity(pid),
    isAlive: !["Z", "X"].includes(fields[0]),
  };
}

/** Records the dispatcher's exact ancestry before any worker can be spawned. */
export async function rememberOwnership(folder) {
  const ancestors = [];
  let pid = process.pid;
  while (pid > 0) {
    const record = await processRecord(pid);
    if (!record.start) throw new Error("Runner ownership unavailable");
    ancestors.push({ pid, start: record.start });
    pid = record.parent;
  }
  await store(join(folder, "ownership.json"), { ancestors });
}

async function isIndependent(record, ownership, earliestStart) {
  if (!Array.isArray(ownership?.ancestors) || !ownership.ancestors.length)
    return false;
  let pid = record.parent;
  try {
    while (pid > 0) {
      const parent = await processRecord(pid);
      if (!parent.start) return false;
      if (Number(parent.start.split(":").at(-1)) < earliestStart)
        return !ownership.ancestors.some(
          (ancestor) => ancestor.pid === pid && ancestor.start === parent.start,
        );
      pid = parent.parent;
    }
  } catch {
    return false;
  }
  return false;
}

async function ownedProcesses(marker, roots, ownership) {
  const records = [];
  let isUncertain = false;
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if ((await stat(`/proc/${entry}`)).uid !== process.getuid()) continue;
      const record = await processRecord(Number(entry));
      if (!record.isAlive || !record.start) continue;
      // Legacy journals lack a boot identity. An apparently matching live root
      // cannot safely be signalled or counted as absent after an upgrade.
      if (
        roots.some(
          (root) =>
            root.processId === record.pid &&
            !root.identity?.includes(":") &&
            root.identity === record.start.split(":").at(-1),
        )
      )
        isUncertain = true;
      let isMarked = false;
      try {
        const environment = await readFile(`/proc/${entry}/environ`, "utf8");
        isMarked = environment
          .split("\0")
          .includes(`PAGES_REMOTE_JOB=${marker}`);
      } catch (error) {
        if (vanished(error)) continue;
        // Never signal an unreadable unrelated process or call this proof of absence.
        const earliestStart = Math.min(
          ...roots.map((root) => Number(root.identity?.split(":").at(-1))),
        );
        if (
          Number(record.start.split(":").at(-1)) >= earliestStart &&
          !(await isIndependent(record, ownership, earliestStart))
        )
          isUncertain = true;
      }
      records.push({ ...record, isMarked });
    } catch (error) {
      if (!vanished(error)) isUncertain = true;
    }
  }
  const owned = new Map();
  for (const record of records) {
    if (
      record.isMarked ||
      roots.some(
        (root) =>
          root.processId === record.pid && root.identity === record.start,
      )
    )
      owned.set(record.pid, record);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of records) {
      if (!owned.has(record.pid) && owned.has(record.parent)) {
        owned.set(record.pid, record);
        grew = true;
      }
    }
  }
  return {
    owned: [...owned.values()].filter((record) => record.pid !== process.pid),
    isUncertain,
  };
}

function failedCleanup(options, failure) {
  options.onFailure?.(failure);
  return "failed";
}

/** Counts the account's tasks, matching Linux RLIMIT_NPROC semantics. */
export async function accountTasks() {
  let count = 0;
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = await readFile(`/proc/${entry}/status`, "utf8");
      if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) === process.getuid())
        count += Number(/^Threads:\s+(\d+)/m.exec(status)?.[1] ?? 1);
    } catch (error) {
      if (!vanished(error) && error.code !== "EACCES") throw error;
    }
  }
  return count;
}

async function signalOwned(records, signal) {
  let isConfirmed = true;
  for (const record of records) {
    if ((await identity(record.pid)) !== record.start) continue;
    try {
      process.kill(
        record.group === record.pid ? -record.pid : record.pid,
        signal,
      );
    } catch (error) {
      if (!vanished(error)) isConfirmed = false;
    }
  }
  return isConfirmed;
}

/** TERM for two seconds, then mandatory KILL for three; verifies marked/reparented children and exact roots. */
export async function cleanup(folder, jobId, options = {}) {
  const roots = [await readRecord(join(folder, "child.json"))];
  if (options.includeWorker)
    roots.push(await readRecord(join(folder, "launch.json")));
  const known = roots.filter(Boolean);
  const ownership = await readRecord(join(folder, "ownership.json"));
  if (
    known.some(
      (root) =>
        !Number.isSafeInteger(root.processId) ||
        typeof root.identity !== "string" ||
        !root.identity,
    ) ||
    (!known.length &&
      !ownership &&
      (await readRecord(join(folder, "claim.json"))))
  )
    return failedCleanup(options, "process_scan_unavailable");
  const tracked = new Map();
  let isConfirmed = true;
  const began = Date.now();
  const deadline = began + STOP_TERM_MILLISECONDS + STOP_KILL_MILLISECONDS;
  let emptySince = null;
  do {
    const scan = await ownedProcesses(jobId, known, ownership);

    for (const record of scan.owned) tracked.set(record.pid, record);
    const remaining = [];
    for (const record of tracked.values())
      if ((await identity(record.pid)) === record.start) remaining.push(record);
    if (!remaining.length) {
      emptySince ??= Date.now();
      if (Date.now() - emptySince >= 200) {
        if (!isConfirmed) return failedCleanup(options, "signal_denied");
        if (scan.isUncertain)
          return failedCleanup(options, "process_scan_unavailable");
        if (options.removeRuntime !== false) {
          await cleanupPagesFiles(folder);
          await rm(join(folder, "runtime"), { recursive: true, force: true });
        }
        return "confirmed";
      }
    } else emptySince = null;
    const signal =
      Date.now() - began < STOP_TERM_MILLISECONDS ? "SIGTERM" : "SIGKILL";
    isConfirmed = (await signalOwned(remaining, signal)) && isConfirmed;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return failedCleanup(options, "exit_timeout");
}
