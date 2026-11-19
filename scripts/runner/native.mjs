import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const SYSTEMCTL = "systemctl";
const SYSTEMD_RUN = "systemd-run";
const CONTROL_GROUP_ROOT = "/sys/fs/cgroup";

/**
 * Whether a job runs natively on this host instead of inside the job namespace.
 *
 * YOLO means a native process of the runner account: no bubblewrap, no
 * namespace and no private mounts. Its scope unit of the user's service
 * manager owns every process it starts, so pausing, stopping and the proof of
 * its end work without a namespace. The local runner uses the same
 * boundary for plan scripts.
 */
export function isNativeJob(job) {
  const program = job?.execution?.program;
  return (
    (program?.kind === "cli" && program.access === "yolo") ||
    (program?.kind === "script" && process.env.PAGES_RUNNER_LOCAL === "1")
  );
}

/** The scope unit of one native job; the job identifier is a UUID, so the name is always valid. */
export function nativeUnitName(jobId) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Invalid job identity");
  return `pages-runner-${jobId}.scope`;
}

function isNativeUnitName(unit) {
  return /^pages-runner-[a-f0-9-]{36}\.scope$/.test(unit ?? "");
}

function managerEnvironment() {
  const runtime =
    process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`;
  return {
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS:
      process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus`,
  };
}

let hasProvenUnits = false;

/**
 * Proves that the user's service manager starts and ends a scope unit.
 *
 * Without it no native job may start, because nothing could own its
 * processes; the job is refused instead of starting in a sandbox. Only a
 * success is remembered, so a repaired host is used again.
 */
export async function canOwnNativeJobs() {
  if (hasProvenUnits) return true;
  const isStarted = await new Promise((resolve) => {
    const probe = spawn(
      SYSTEMD_RUN,
      [
        "--user",
        "--scope",
        "--quiet",
        "--collect",
        `--unit=pages-runner-probe-${process.pid}-${Date.now()}.scope`,
        "--",
        "/bin/true",
      ],
      { stdio: "ignore", timeout: 10000, env: managerEnvironment() },
    );
    probe.once("error", () => resolve(false));
    probe.once("close", (code) => resolve(code === 0));
  });
  hasProvenUnits = isStarted;
  return isStarted;
}

/**
 * The arguments that start the job supervisor in its own scope unit.
 *
 * `systemd-run --scope` moves itself into the new unit and then runs the
 * supervisor in place, so the started process keeps its PID and start time
 * and the unit's control group holds every child, grandchild and stdio MCP
 * server of the job.
 */
export function nativeLaunchArguments(unit, command, options = {}) {
  if (!isNativeUnitName(unit)) throw new Error("Invalid native job unit");
  return [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    "--property=KillMode=control-group",
    ...(options.isScript
      ? [
          "--property=MemoryMax=8G",
          "--property=MemorySwapMax=0",
          "--property=TasksMax=512",
          "--property=CPUQuota=200%",
        ]
      : []),
    "--",
    ...command,
  ];
}

/** The program that starts a native job supervisor. */
export const NATIVE_LAUNCHER = SYSTEMD_RUN;

/**
 * The PATH of the account's login shell, so programs the account installed
 * stay reachable for the native job; falls back to the runner's own PATH.
 */
export async function loginPath() {
  const account = userInfo();
  try {
    const { stdout } = await runFile(
      account.shell || "/bin/sh",
      ["-lc", 'printf %s "$PATH"'],
      {
        timeout: 10000,
        env: {
          HOME: account.homedir,
          USER: account.username,
          LOGNAME: account.username,
          SHELL: account.shell || "/bin/sh",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          LANG: process.env.LANG ?? "C.UTF-8",
        },
      },
    );
    if (stdout && !stdout.includes("\0")) return stdout;
  } catch {
    /* The runner's own PATH stays the fallback; the job still starts. */
  }
  return process.env.PATH ?? "/usr/bin:/bin";
}

/**
 * The CLI search path of a native job.
 *
 * The managed CLI generations come first, so a host starter of the same name
 * (one that looks for its installation below the real home) never replaces
 * the CLI of the connection; the login PATH follows unchanged for every other
 * host program, then the runner's own PATH. Empty entries would search the
 * working directory and are dropped.
 */
export function nativeCliPath(login, environment = process.env) {
  const entries = [
    environment.PAGES_RUNNER_MANAGED_CLI_PATH,
    login,
    environment.PAGES_RUNNER_CLI_PATH ?? environment.PATH,
  ].flatMap((searchPath) => (searchPath ? searchPath.split(":") : []));
  return [...new Set(entries.filter((entry) => entry !== ""))].join(":");
}

async function controlGroupOf(unit) {
  if (!isNativeUnitName(unit)) throw new Error("Invalid native job unit");
  const { stdout } = await runFile(
    SYSTEMCTL,
    ["--user", "show", "--property=ControlGroup", "--value", unit],
    { timeout: 5000, env: managerEnvironment() },
  );
  const group = stdout.trim();
  if (group !== "" && (!group.startsWith("/") || group.includes("..")))
    throw new Error("Invalid native job control group");
  return group;
}

async function processesBelow(directory) {
  let pids = [];
  try {
    const content = await readFile(join(directory, "cgroup.procs"), "utf8");
    pids = content.trim().split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory())
      pids.push(...(await processesBelow(join(directory, entry.name))));
  return pids;
}

/**
 * Every process the scope unit of a native job still holds.
 *
 * A unit the service manager no longer knows holds none: a scope is
 * collected only after its control group is empty.
 */
export async function nativeUnitProcesses(unit) {
  const group = await controlGroupOf(unit);
  if (group === "") return [];
  return processesBelow(join(CONTROL_GROUP_ROOT, group));
}

/** The processes of the caller's own unit, as the supervisor inside it sees them. */
export async function ownUnitProcesses(unit) {
  if (!isNativeUnitName(unit)) throw new Error("Invalid native job unit");
  const membership = await readFile("/proc/self/cgroup", "utf8");
  const group = /^0::(\/\S*)$/m.exec(membership)?.[1];
  if (!group || !group.endsWith(`/${unit}`) || group.includes(".."))
    throw new Error("Runner unit ownership unavailable");
  return processesBelow(join(CONTROL_GROUP_ROOT, group));
}

/** Sends a signal to every process of the unit; a unit that is gone has none left. */
export async function signalNativeUnit(unit, signal) {
  if (!isNativeUnitName(unit)) throw new Error("Invalid native job unit");
  try {
    await runFile(
      SYSTEMCTL,
      ["--user", "kill", "--kill-whom=all", `--signal=${signal}`, unit],
      { timeout: 5000, env: managerEnvironment() },
    );
  } catch (error) {
    if ((await nativeUnitProcesses(unit)).length > 0) throw error;
  }
}

/** Freezes or thaws every process of the unit, without ending any of them. */
export async function freezeNativeUnit(unit, isPaused) {
  if (!isNativeUnitName(unit)) throw new Error("Invalid native job unit");
  await runFile(SYSTEMCTL, ["--user", isPaused ? "freeze" : "thaw", unit], {
    timeout: 5000,
    env: managerEnvironment(),
  });
}
