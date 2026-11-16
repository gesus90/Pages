import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { readRecord, store } from "./journal.mjs";

const execute = promisify(execFile);
const MAXIMUM_PACKAGE_BYTES = 1024 * 1024;

/** Refuses replacement until every durable claim and its final acknowledgement are settled. */
export function updateDeferral(configuration) {
  if (
    configuration.pending ||
    configuration.jobs.some(
      (job) => (job.historyCursor ?? 0) < (job.historyLength ?? 0),
    )
  )
    return "pending_receipt";
  if (
    configuration.jobs.some(
      (job) =>
        !["completed", "failed", "interrupted", "lost"].includes(job.status) ||
        (job.outcome?.closeout !== "confirmed" &&
          job.cancellation?.closeout !== "confirmed"),
    )
  )
    return "active_jobs";
  return null;
}

/** Checks digest, bounded JSON and flat module names before writing any executable file. */
function packageBytes(offer) {
  if (
    !offer ||
    !/^\d+\.\d+\.\d+$/u.test(offer.version) ||
    !/^[a-f0-9]{64}$/u.test(offer.sha256) ||
    typeof offer.payload !== "string" ||
    offer.payload.length > Math.ceil(MAXIMUM_PACKAGE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(offer.payload)
  )
    throw new Error("Invalid runner package envelope");
  const bytes = Buffer.from(offer.payload, "base64");
  if (
    bytes.length > MAXIMUM_PACKAGE_BYTES ||
    bytes.toString("base64") !== offer.payload ||
    createHash("sha256").update(bytes).digest("hex") !== offer.sha256
  )
    throw new Error("Invalid runner package SHA-256");
  return bytes;
}

/** Checks digest, bounded JSON and flat module names before writing any executable file. */
export function decodeRunnerPackage(offer) {
  const artifact = JSON.parse(packageBytes(offer).toString("utf8"));
  if (
    artifact.version !== offer.version ||
    !artifact.files ||
    typeof artifact.files !== "object" ||
    Array.isArray(artifact.files) ||
    Object.keys(artifact.files).length > 64
  )
    throw new Error("Invalid runner package manifest");
  for (const [name, source] of Object.entries(artifact.files)) {
    if (
      !/^[a-z][a-z-]*\.mjs$/u.test(name) ||
      typeof source !== "string" ||
      source.includes("\0")
    )
      throw new Error("Invalid runner package module");
  }
  for (const name of [
    "transport.mjs",
    "journal.mjs",
    "update.mjs",
    "address.mjs",
  ])
    if (typeof artifact.files[name] !== "string")
      throw new Error("Incomplete runner package");
  return artifact;
}

/** Requires private, owned directories and never follows a release-directory symlink. */
export async function privateUpdateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid() ||
    metadata.mode & 0o077
  )
    throw new Error("Invalid runner update directory");
}

/** Stages a complete release and checks its real version; only the final pointer rename activates it. */
export async function stageRunnerUpdate(directory, offer, options = {}) {
  const artifact = decodeRunnerPackage(offer);
  await privateUpdateDirectory(directory);
  const releases = join(directory, "releases");
  await privateUpdateDirectory(releases);
  const staging = join(releases, `.pending-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, source] of Object.entries(artifact.files)) {
      const handle = await open(join(staging, name), "wx", 0o600);
      try {
        await handle.writeFile(source);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const probe =
      options.probe ??
      (async (entry) => {
        const result = await execute(process.execPath, [entry, "--version"], {
          timeout: 15000,
          maxBuffer: 4096,
        });
        return result.stdout.trim();
      });
    if (
      (await probe(join(staging, "transport.mjs"))) !==
      `pages-runner ${offer.version}`
    )
      throw new Error("Runner package version mismatch");
    const release = `${offer.sha256}-${randomUUID()}`;
    const stagedDirectory = await open(staging, "r");
    try {
      await stagedDirectory.sync();
    } finally {
      await stagedDirectory.close();
    }
    await rename(staging, join(releases, release));
    const releaseDirectory = await open(releases, "r");
    try {
      await releaseDirectory.sync();
    } finally {
      await releaseDirectory.close();
    }
    const previous = await readRecord(join(directory, "active-release.json"));
    await store(join(directory, "update-result.json"), {
      status: "restarting",
      targetVersion: offer.version,
    });
    await store(join(directory, "active-release.json"), {
      release,
      version: offer.version,
      previous: previous?.release ?? null,
      previousVersion: previous?.version ?? null,
      pending: true,
    });
    return release;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The candidate is healthy only after authenticated reconciliation, with its actual version. */
export async function confirmRunnerUpdate(directory, version) {
  const active = await readRecord(join(directory, "active-release.json"));
  if (
    !active?.pending ||
    active.version !== version ||
    active.release !== process.env.PAGES_RUNNER_RELEASE
  )
    return;
  await store(join(directory, "release-health.json"), {
    release: active.release,
    version,
  });
  await store(join(directory, "active-release.json"), {
    ...active,
    pending: false,
  });
}

/** Restores the last pointer and records a durable, secret-free restart failure. */
export async function rollbackRunnerUpdate(directory, active) {
  if (active.previous) {
    await store(join(directory, "active-release.json"), {
      release: active.previous,
      version: active.previousVersion,
      pending: false,
    });
  } else await rm(join(directory, "active-release.json"), { force: true });
  await store(join(directory, "update-result.json"), {
    status: "rolled-back",
    reason: "restart_failed",
    targetVersion: active.version,
    failedVersion: active.version,
  });
}
