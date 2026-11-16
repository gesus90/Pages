import { readdir, readFile, readlink, rm } from "node:fs/promises";
import { join } from "node:path";

import { freezeScope, stopScope } from "./cgroups.mjs";
import { cleanupPagesFiles } from "./pages.mjs";
import { removeRunnerTemporaryDirectory } from "./temporary.mjs";
import { identity, readRecord, readOwnedLaunch, store } from "./journal.mjs";
import {
  freezeNativeUnit,
  nativeUnitProcesses,
  ownUnitProcesses,
  signalNativeUnit,
} from "./native.mjs";

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

/** The process IDs of the supervisor and every ancestor, which a scan never signals. */
async function ancestorIds() {
  const ancestors = new Set();
  let pid = process.pid;
  while (pid > 0) {
    ancestors.add(pid);
    pid = (await processRecord(pid)).parent;
  }
  return ancestors;
}

/** The live processes of the supervisor's own scope unit, apart from itself. */
async function unitProcesses(launch) {
  if (launch?.boundary !== "worker_unit")
    throw new Error("Runner unit ownership unavailable");
  const ancestors = await ancestorIds();
  const owned = [];
  let isUncertain = false;
  for (const pid of await ownUnitProcesses(launch.unit)) {
    if (ancestors.has(pid)) continue;
    try {
      const record = await processRecord(pid);
      if (record.isAlive && record.start) owned.push(record);
    } catch (error) {
      if (!vanished(error)) isUncertain = true;
    }
  }
  return { owned, isUncertain };
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
  const ancestors = await ancestorIds();
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
    await removeRunnerTemporaryDirectory(
      await readRecord(join(folder, "claim.json")),
    );
  }
  return "confirmed";
}

/**
 * Ends a native job from the host side: first its supervisor, as for a
 * namespace, then everything its scope unit still holds, and confirms that
 * the unit holds nothing any more before the runtime files go.
 */
async function settleUnit(folder, launch, options) {
  if (typeof launch.unit !== "string")
    return failedCleanup(options, "process_scan_unavailable");
  const supervisor = await settleSupervisor(folder, launch, {
    ...options,
    removeRuntime: false,
  });
  if (supervisor !== "confirmed") return supervisor;
  const began = Date.now();
  const deadline = began + STOP_TERM_MILLISECONDS + STOP_KILL_MILLISECONDS;
  for (;;) {
    let remaining;
    try {
      remaining = await nativeUnitProcesses(launch.unit);
    } catch {
      return failedCleanup(options, "process_scan_unavailable");
    }
    if (remaining.length === 0) break;
    if (Date.now() >= deadline) return failedCleanup(options, "exit_timeout");
    try {
      await signalNativeUnit(
        launch.unit,
        Date.now() - began < STOP_TERM_MILLISECONDS ? "SIGTERM" : "SIGKILL",
      );
    } catch {
      return failedCleanup(options, "signal_denied");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (options.removeRuntime !== false) {
    await cleanupPagesFiles(folder);
    await rm(join(folder, "runtime"), { recursive: true, force: true });
    await removeRunnerTemporaryDirectory(
      await readRecord(join(folder, "claim.json")),
    );
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

/** Signals only processes in the owned namespace or scope unit; legacy jobs remain unconfirmed. */
export async function cleanup(folder, jobId, options = {}) {
  if (typeof jobId !== "string" || !jobId)
    return failedCleanup(options, "process_scan_unavailable");
  const isUnit = process.env.PAGES_RUNNER_JOB_BOUNDARY === "worker_unit";
  const isNamespace = process.env.PAGES_RUNNER_JOB_NAMESPACE === "1" || isUnit;
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
  if (launch?.boundary === "pid_namespace" && !isNamespace) {
    if (launch.cgroup) {
      const closeout = await stopScope(launch.cgroup, jobId);
      if (closeout !== "confirmed")
        return failedCleanup(options, "exit_timeout");
    }
    return settleSupervisor(folder, launch, options);
  }
  if (launch?.boundary === "worker_unit" && !isNamespace)
    return settleUnit(folder, launch, options);
  if (!isNamespace) return failedCleanup(options, "process_scan_unavailable");
  const tracked = new Map();
  let isConfirmed = true;
  const began = Date.now();
  const deadline = began + STOP_TERM_MILLISECONDS + STOP_KILL_MILLISECONDS;
  let emptySince = null;
  do {
    const scan = isUnit
      ? await unitProcesses(launch)
      : await namespaceProcesses(launch);

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

/** Records actual cgroup state; unsupported hosts never claim an in-turn pause. */
export async function pauseExecution(folder, isPaused) {
  const launch = await readOwnedLaunch(folder);
  if (!launch || launch.boundary === "not_started") return null;
  const file = join(folder, "pause.json");
  const previous = await readRecord(file);
  if (
    await readRecord(
      join(folder, "..", `${folder.split("/").at(-1)}.cancel.json`),
    )
  )
    return null;
  if (
    (!launch.cgroup && previous?.state === "unavailable") ||
    (previous?.isPaused === isPaused &&
      ["frozen", "thawed"].includes(previous.state))
  )
    return previous;
  let state = "unavailable";
  try {
    if (launch.boundary === "worker_unit") {
      await freezeNativeUnit(launch.unit, isPaused);
      state = isPaused ? "frozen" : "thawed";
    } else if (launch.cgroup)
      state = await freezeScope(
        launch.cgroup,
        folder.split("/").at(-1),
        isPaused,
      );
  } catch {
    state = "failed";
  }
  const isFrozen = state === "frozen";
  const now = Date.now();
  const result = {
    state,
    isPaused: isFrozen,
    observedAt: new Date(now).toISOString(),
    startedAt: isFrozen ? (previous?.startedAt ?? now) : null,
    totalMilliseconds:
      (previous?.totalMilliseconds ?? 0) +
      (previous?.isPaused && !isFrozen ? now - previous.startedAt : 0),
  };
  await store(file, result);
  return result;
}
