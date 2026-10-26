import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { cleanup } from "./processes.mjs";
import { store, readRecord } from "./journal.mjs";

export const EXECUTION_LEASE_MILLISECONDS = 45000;
const stopping = new Map();

async function bootClock() {
  const [uptime, boot] = await Promise.all([
    readFile("/proc/uptime", "utf8"),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  ]);
  return {
    boot: boot.trim(),
    milliseconds: Number(uptime.split(" ")[0]) * 1000,
  };
}

/** Authenticated contact grants a bounded, boot-bound execution lease, never a restart. */
export async function renewExecutionLease(directory, sessionId) {
  const clock = await bootClock();
  await store(join(directory, "execution-lease.json"), {
    sessionId,
    boot: clock.boot,
    expiresAt: clock.milliseconds + EXECUTION_LEASE_MILLISECONDS,
  });
}

/** A missing, expired, foreign-boot or unreadable lease fails closed. */
export async function hasExecutionLease(directory, job) {
  try {
    const [lease, clock] = await Promise.all([
      readRecord(join(directory, "execution-lease.json")),
      bootClock(),
    ]);
    return (
      lease?.sessionId === job.sessionId &&
      lease.boot === clock.boot &&
      clock.milliseconds < lease.expiresAt
    );
  } catch {
    return false;
  }
}

/** Durable local fencing is read before every launch and throughout execution. */
export async function cancellationFor(directory, job) {
  const request = await readRecord(
    join(directory, "jobs", `${job.jobId}.cancel.json`),
  );
  if (!request) return null;
  if (
    request.sessionId !== job.sessionId ||
    request.attemptId !== job.plan?.attemptId
  )
    throw new Error("Runner cancellation identity mismatch");
  return { requestedAt: request.requestedAt, receivedAt: request.receivedAt };
}

async function revokeJob(directory, job) {
  if (!/^[a-f0-9-]{36}$/u.test(job.jobId) || !job.plan || !job.cancellation)
    throw new Error("Invalid cancellation");
  await mkdir(join(directory, "jobs"), { recursive: true, mode: 0o700 });
  const existing = await cancellationFor(directory, job);
  if (existing?.requestedAt !== job.cancellation.requestedAt)
    await store(join(directory, "jobs", `${job.jobId}.cancel.json`), {
      sessionId: job.sessionId,
      attemptId: job.plan.attemptId,
      requestedAt: job.cancellation.requestedAt,
      receivedAt: existing?.receivedAt ?? new Date().toISOString(),
    });
  const folder = join(directory, "jobs", job.jobId);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const stopped = await readRecord(join(folder, "stop.json"));
  if (
    stopped?.requestedAt === job.cancellation.requestedAt &&
    stopped.closeout === "confirmed"
  ) {
    await rm(join(folder, "runtime"), { recursive: true, force: true });
    return;
  }
  let failure;
  const closeout = await cleanup(folder, job.jobId, {
    includeWorker: true,
    onFailure: (reason) => {
      failure = reason;
    },
  }).catch(() => {
    failure = "process_scan_unavailable";
    return "failed";
  });
  const evidence = {
    ...(await cancellationFor(directory, job)),
    completedAt: new Date().toISOString(),
    closeout,
    ...(failure ? { failure } : {}),
  };
  await store(join(folder, "stop.json"), evidence);
  const previous = await readRecord(join(folder, "result.json"));
  if (!previous || previous.result?.closeout !== "confirmed")
    await store(join(folder, "result.json"), {
      status: "interrupted",
      result: {
        output: null,
        exitCode: null,
        signal: null,
        reason: "cancelled",
        closeout,
      },
    });
  // A cancellation-only claim closes the mkdir race with a dispatch still in admission.
  if (!(await readRecord(join(folder, "claim.json"))))
    await store(join(folder, "claim.json"), job);
}

/** Stop runs independently of event transfer and kills the worker as well as its descendants. */
export async function cancelJob(directory, job) {
  const key = `${directory}:${job.jobId}`;
  if (stopping.has(key)) return stopping.get(key);
  const pending = revokeJob(directory, job).finally(() => stopping.delete(key));
  stopping.set(key, pending);
  return pending;
}
