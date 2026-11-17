import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const CGROUP_ROOT = "/sys/fs/cgroup";

class ScopeGoneError extends Error {}

async function systemctl(args) {
  const result = await execute("/usr/bin/systemctl", ["--user", ...args], {
    timeout: 5000,
    maxBuffer: 16384,
    env: {
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`,
      LC_ALL: "C",
    },
  });
  return result.stdout.trim();
}

/** Advertises cgroup control only on a unified host with a reachable user manager. */
export async function cgroupCapabilities() {
  try {
    await access(`${CGROUP_ROOT}/cgroup.controllers`);
    await access("/usr/bin/systemd-run");
    const version = await systemctl(["show", "--property=Version", "--value"]);
    if (!(Number.parseInt(version, 10) >= 246))
      return { isolationVersion: 1, executionControlVersion: 1 };
    return {
      isolationVersion: 1,
      executionControlVersion: 1,
      cgroupVersion: 1,
    };
  } catch {
    return { isolationVersion: 1, executionControlVersion: 1 };
  }
}

/** Uses an immutable job identity for the host-owned scope. */
export function scopeUnit(jobId) {
  if (!/^[a-f0-9-]{36}$/u.test(jobId))
    throw new Error("Invalid scope identity");
  return `pages-runner-job-${jobId}.scope`;
}

/** Starts the existing namespace inside a resource-limited per-step scope. */
export function scopeCommand(jobId, command) {
  return {
    file: "/usr/bin/systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${scopeUnit(jobId)}`,
      "--property=MemoryMax=8G",
      "--property=MemorySwapMax=0",
      "--property=TasksMax=512",
      "--property=CPUQuota=200%",
      "--",
      ...command,
    ],
  };
}

async function scopePath(unit) {
  const path = await systemctl([
    "show",
    unit,
    "--property=ControlGroup",
    "--value",
  ]);
  if (
    !path &&
    (await systemctl(["show", unit, "--property=LoadState", "--value"])) ===
      "not-found"
  )
    throw new ScopeGoneError("Runner scope was collected");
  if (
    !path.startsWith("/") ||
    path.includes("..") ||
    !path.endsWith(`/${unit}`)
  )
    throw new Error("Runner scope ownership unavailable");
  return `${CGROUP_ROOT}${path}`;
}

/** Confirms ownership before the worker's stdin launch gate is released. */
export async function confirmScope(jobId) {
  const unit = scopeUnit(jobId);
  const deadline = Date.now() + 5000;
  do {
    try {
      const path = await scopePath(unit);
      await access(`${path}/cgroup.freeze`);
      return { unit, path };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } while (Date.now() < deadline);
  throw new Error("Runner cgroup launch could not be confirmed");
}

async function events(scope) {
  try {
    return await readFile(`${scope.path}/cgroup.events`, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "populated 0\nfrozen 0\n";
    throw error;
  }
}

async function requireScope(scope, jobId) {
  if (
    scope.unit !== scopeUnit(jobId) ||
    (await scopePath(scope.unit)) !== scope.path
  )
    throw new Error("Runner scope identity changed");
}

/** Freezes/thaws the entire cgroup and waits for the kernel's actual state. */
export async function freezeScope(scope, jobId, isPaused) {
  if (scope.unit !== scopeUnit(jobId))
    throw new Error("Runner scope identity changed");
  if ((await events(scope)).includes("populated 0")) return "terminated";
  await requireScope(scope, jobId);
  await systemctl([isPaused ? "freeze" : "thaw", scope.unit]);
  const deadline = Date.now() + 5000;
  do {
    const state = await events(scope);
    if (state.includes("populated 0")) return "terminated";
    if (state.includes(`frozen ${isPaused ? 1 : 0}`))
      return isPaused ? "frozen" : "thawed";
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error("Runner cgroup suspension could not be confirmed");
}

async function killScope(scope) {
  try {
    await systemctl(["kill", "--kill-who=all", "--signal=SIGKILL", scope.unit]);
  } catch (error) {
    // Only the manager's specific missing-unit reply permits a second lookup.
    // Permission, transport and ownership failures must remain failures.
    const missing = `Failed to kill unit ${scope.unit}: Unit ${scope.unit} not loaded.`;
    if (error.code !== 1 || error.stderr?.trim() !== missing) throw error;
    await scopePath(scope.unit);
    throw error;
  }
}

async function confirmGoneScope(scope, error) {
  if (!(error instanceof ScopeGoneError)) return "failed";
  try {
    return (await events(scope)).includes("populated 0")
      ? "confirmed"
      : "failed";
  } catch {
    return "failed";
  }
}

/** Kills every member, including frozen or reparented descendants, and proves emptiness. */
export async function stopScope(scope, jobId) {
  try {
    if (
      scope.unit !== scopeUnit(jobId) ||
      typeof scope.path !== "string" ||
      !scope.path.startsWith(`${CGROUP_ROOT}/`) ||
      scope.path.includes("..") ||
      !scope.path.endsWith(`/${scope.unit}`)
    )
      return "failed";
    if ((await events(scope)).includes("populated 0")) return "confirmed";
    await requireScope(scope, jobId);
    const deadline = Date.now() + 5000;
    do {
      try {
        await writeFile(`${scope.path}/cgroup.kill`, "1");
      } catch (error) {
        if (!["ENOENT", "EACCES", "EPERM", "EOPNOTSUPP"].includes(error.code))
          throw error;
        if ((await events(scope)).includes("populated 0")) return "confirmed";
        await killScope(scope);
      }
      if ((await events(scope)).includes("populated 0")) return "confirmed";
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    return "failed";
  } catch (error) {
    // A collected unit is success only after rechecking its saved kernel boundary.
    return confirmGoneScope(scope, error);
  }
}

/** Revokes a launch whose scope handshake failed before any work was authorized. */
export async function abortScope(jobId) {
  try {
    await systemctl([
      "kill",
      "--kill-who=all",
      "--signal=SIGKILL",
      scopeUnit(jobId),
    ]);
  } catch {
    // The stdin gate remains closed; a missing unit cannot start work.
    console.error("Runner scope launch was not confirmed.");
  }
}
