import { cleanupPagesFiles } from "./pages.mjs";
import { readdir, readFile, readlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { identity, readRecord, readOwnedLaunch, store } from "./journal.mjs";

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

async function namespaceProcesses(launch) {
  const current = await readlink("/proc/self/ns/pid");
  const procNamespace = await readlink("/proc/1/ns/pid");
  if (
    launch?.boundary !== "pid_namespace" ||
    !/^pid:\[\d+\]$/.test(launch.parentNamespace ?? "") ||
    !/^pid:\[\d+\]$/.test(current) ||
    procNamespace !== current ||
    current === launch.parentNamespace
  )
    throw new Error("Runner namespace ownership unavailable");
  const ancestors = new Set();
  let pid = process.pid;
  while (pid > 0) {
    ancestors.add(pid);
    pid = (await processRecord(pid)).parent;
  }
  const owned = [];
  let isUncertain = false;
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry) || ancestors.has(Number(entry))) continue;
    try {
      const record = await processRecord(Number(entry));
      if (record.isAlive && record.start) owned.push(record);
    } catch (error) {
      if (!vanished(error)) isUncertain = true;
    }
  }
  return { owned, isUncertain };
}

async function settleSupervisor(folder, launch, options) {
  if (
    !Number.isSafeInteger(launch.processId) ||
    typeof launch.identity !== "string" ||
    !launch.identity.includes(":")
  )
    return failedCleanup(options, "process_scan_unavailable");
  const deadline = Date.now() + STOP_TERM_MILLISECONDS + STOP_KILL_MILLISECONDS;
  const began = Date.now();
  while ((await identity(launch.processId)) === launch.identity) {
    if (options.includeWorker) {
      try {
        process.kill(
          launch.processId,
          Date.now() - began < STOP_TERM_MILLISECONDS ? "SIGTERM" : "SIGKILL",
        );
      } catch (error) {
        if (!vanished(error)) return failedCleanup(options, "signal_denied");
      }
    }
    if (Date.now() >= deadline) return failedCleanup(options, "exit_timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (options.removeRuntime !== false) {
    await cleanupPagesFiles(folder);
    await rm(join(folder, "runtime"), { recursive: true, force: true });
  }
  return "confirmed";
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
      process.kill(record.pid, signal);
    } catch (error) {
      if (!vanished(error)) isConfirmed = false;
    }
  }
  return isConfirmed;
}

/** Signals only processes in the owned namespace; legacy jobs remain unconfirmed. */
export async function cleanup(folder, jobId, options = {}) {
  if (typeof jobId !== "string" || !jobId)
    return failedCleanup(options, "process_scan_unavailable");
  const isNamespace = process.env.PAGES_RUNNER_JOB_NAMESPACE === "1";
  const launch = isNamespace
    ? await readRecord(join(folder, "launch.json"))
    : await readOwnedLaunch(folder);
  if (!isNamespace && launch?.boundary === "not_started") {
    const claim = await readRecord(join(folder, "claim.json"));
    if (
      claim?.jobId !== jobId ||
      (launch.jobId &&
        (launch.jobId !== jobId ||
          launch.sessionId !== claim.sessionId ||
          launch.attemptId !== claim.plan?.attemptId))
    )
      return failedCleanup(options, "process_scan_unavailable");
    return "confirmed";
  }
  if (launch?.boundary === "pid_namespace" && !isNamespace)
    return settleSupervisor(folder, launch, options);
  if (!isNamespace) return failedCleanup(options, "process_scan_unavailable");
  const tracked = new Map();
  let isConfirmed = true;
  const began = Date.now();
  const deadline = began + STOP_TERM_MILLISECONDS + STOP_KILL_MILLISECONDS;
  let emptySince = null;
  do {
    const scan = await namespaceProcesses(launch);

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
