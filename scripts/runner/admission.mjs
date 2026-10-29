import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { identity, readRecord, readOwnedLaunch, store } from "./journal.mjs";

const execute = promisify(execFile);
const MAXIMUM_ACTIVE_JOBS = 4;
// Shared by every runner of this account; a home directory cannot be pre-created by other users like /tmp.
const root =
  process.env.PAGES_RUNNER_ADMISSION_DIRECTORY ??
  join(homedir(), ".local", "state", "pages-runner-admission");
if (!root.startsWith("/") || root.includes("\0"))
  throw new Error("Invalid runner admission directory");

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid() ||
    metadata.mode & 0o077
  )
    throw new Error("Invalid runner admission directory");
}

function leasePath(job) {
  const digest = createHash("sha256")
    .update(`${job.sessionId}:${job.jobId}:${job.plan.attemptId}`)
    .digest("hex");
  return join(root, `${digest}.json`);
}

async function workspaceResources(workspace) {
  const path = await realpath(workspace);
  try {
    const options = { cwd: path, timeout: 1000, maxBuffer: 8192 };
    const [directory, branch] = await Promise.all([
      execute(
        "/usr/bin/git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        options,
      ),
      execute("/usr/bin/git", ["symbolic-ref", "--quiet", "HEAD"], options),
    ]);
    return {
      path,
      branch: `${directory.stdout.trim()}:${branch.stdout.trim()}`,
    };
  } catch {
    return { path, branch: null };
  }
}

function overlaps(first, second) {
  return (
    first === second ||
    first.startsWith(`${second}/`) ||
    second.startsWith(`${first}/`)
  );
}

/** Keeps a working copy reserved until its original worker has closed out. */
export async function isLeaseActive(lease) {
  const launch = await readOwnedLaunch(lease.folder);
  if (!launch || launch.boundary === "preparing") return true;
  if (
    launch.boundary !== "not_started" &&
    (launch.boundary !== "pid_namespace" ||
      !Number.isSafeInteger(launch.processId) ||
      typeof launch.identity !== "string")
  )
    return true;
  if (
    launch.boundary === "pid_namespace" &&
    (await identity(launch.processId)) === launch.identity
  )
    return true;
  const result = await readRecord(join(lease.folder, "result.json"));
  return result?.result?.closeout !== "confirmed";
}

async function activeLeases() {
  const active = [];
  for (const entry of await readdir(root)) {
    if (!/^[a-f0-9]{64}\.json$/u.test(entry)) continue;
    const path = join(root, entry);
    const lease = await readRecord(path);
    if (!lease) continue;
    if (await isLeaseActive(lease)) active.push(lease);
    else await rm(path);
  }
  return active;
}

async function reserveJob(directory, job) {
  const resources = await workspaceResources(job.execution.workspace);
  const leases = await activeLeases();
  if (
    leases.some(
      (lease) => lease.jobId === job.jobId && lease.sessionId === job.sessionId,
    )
  )
    return null;
  if (
    leases.some(
      (lease) =>
        overlaps(lease.path, resources.path) ||
        (resources.branch && lease.branch === resources.branch),
    )
  )
    return "workspace";
  if (leases.length >= MAXIMUM_ACTIVE_JOBS) return "capacity";
  await store(leasePath(job), {
    ...resources,
    jobId: job.jobId,
    sessionId: job.sessionId,
    attemptId: job.plan.attemptId,
    folder: join(directory, "jobs", job.jobId),
    createdAt: Date.now(),
    processId: Number(process.argv[5]),
    identity: await identity(Number(process.argv[5])),
  });
  return null;
}

/** The kernel releases flock on crashes; no stale userspace mutex can block all runners. */
export async function admitJob(directory, job) {
  await privateDirectory(root);
  try {
    const result = await execute(
      "/usr/bin/flock",
      [
        "--wait",
        "1",
        "--conflict-exit-code",
        "73",
        join(root, "admission.lock"),
        process.execPath,
        fileURLToPath(import.meta.url),
        "--reserve",
        directory,
        job.jobId,
        String(process.pid),
      ],
      { timeout: 5000, maxBuffer: 1024 },
    );
    const reason = result.stdout.trim();
    if (["capacity", "workspace"].includes(reason)) return reason;
    if (reason !== "admitted")
      throw new Error("Invalid runner admission response");
    return null;
  } catch (error) {
    if (error.code === 73) return "capacity";
    throw new Error("Runner admission failed");
  }
}

/** Only this exact attempt's reservation is released; unrelated workspaces remain untouched. */
export async function releaseJob(job) {
  const path = leasePath(job);
  const lease = await readRecord(path);
  if (
    lease?.jobId === job.jobId &&
    lease.sessionId === job.sessionId &&
    lease.attemptId === job.plan.attemptId &&
    !(await isLeaseActive(lease))
  )
    await rm(path, { force: true });
}

if (process.argv[2] === "--reserve") {
  const directory = process.argv[3];
  const jobId = process.argv[4];
  if (!directory?.startsWith("/") || !/^[a-f0-9-]{36}$/u.test(jobId))
    throw new Error("Invalid runner admission request");
  await privateDirectory(root);
  const configuration = await readRecord(join(directory, "config.json"));
  const job = configuration?.jobs.find((entry) => entry.jobId === jobId);
  if (!job?.plan || !job.execution)
    throw new Error("Unknown runner admission job");
  process.stdout.write((await reserveJob(directory, job)) ?? "admitted");
}
