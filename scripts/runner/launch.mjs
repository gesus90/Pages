import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareAgentHome } from "./accounts.mjs";
import { antigravityContextProof } from "./antigravity.mjs";
import {
  cgroupCapabilities,
  scopeCommand,
  confirmScope,
  abortScope,
} from "./cgroups.mjs";
import {
  identity,
  readOwnedLaunch,
  ownershipDirectory,
  store,
} from "./journal.mjs";
import { accountTasks, rememberOwnership } from "./processes.mjs";
import {
  NATIVE_LAUNCHER,
  isNativeJob,
  loginPath,
  nativeLaunchArguments,
  nativeUnitName,
} from "./native.mjs";
import { cancellationFor, cancelJob } from "./revocation.mjs";
import { sshConfigOverlay } from "./ssh.mjs";
import {
  prepareRunnerTemporaryDirectory,
  removeRunnerTemporaryDirectory,
} from "./temporary.mjs";

/** A persistent claim is never spawned a second time, even after a bootstrap crash. */
export async function claimJob(directory, job) {
  if (
    !/^[a-f0-9-]{36}$/.test(job.jobId) ||
    !job.plan ||
    job.execution?.version !== 1
  )
    throw new Error("Invalid dispatch");
  const folder = join(directory, "jobs", job.jobId);
  await mkdir(join(directory, "jobs"), { recursive: true, mode: 0o700 });
  try {
    await mkdir(folder, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
  await store(join(folder, "claim.json"), job);
  // Folder recreation cannot authorize a second worker or erase protected launch evidence.
  if ((await readOwnedLaunch(folder)) || job.launch || job.status !== "queued")
    return;
  await rememberOwnership(folder);
  const ownership = await ownershipDirectory(directory);
  const ownershipPath = join(ownership, `${job.jobId}.json`);
  await store(ownershipPath, { boundary: "preparing" });
  // A stop that arrived during admission must not start the worker.
  if (await cancellationFor(directory, job)) {
    await store(ownershipPath, {
      boundary: "not_started",
      jobId: job.jobId,
      sessionId: job.sessionId,
      attemptId: job.plan.attemptId,
    });
    await store(join(folder, "result.json"), {
      status: "interrupted",
      result: {
        output: null,
        closeout: "confirmed",
        exitCode: null,
        signal: null,
        reason: "cancelled",
      },
    });
    return;
  }
  await launchWorker({ directory, job, folder, ownership, ownershipPath });
}

async function launchWorker(context) {
  const { directory, job, folder, ownership, ownershipPath } = context;
  const parentNamespace = await readlink("/proc/self/ns/pid");
  const hostTasks =
    job.execution.program?.kind === "script" ? await accountTasks() : null;
  const contextProof =
    !job.execution.agentAccount &&
    job.execution.program?.kind === "cli" &&
    job.execution.program.route.tool === "antigravity"
      ? await antigravityContextProof()
      : "[]";
  // A YOLO job runs natively in its own scope unit; every other job keeps the namespace.
  const unit = isNativeJob(job) ? nativeUnitName(job.jobId) : null;
  const sshConfig = unit
    ? []
    : await sshConfigOverlay(join(folder, "ssh_config.d"));
  const temporaryDirectory = await prepareRunnerTemporaryDirectory(job);
  const account = await prepareAgentHome(directory, job.execution);
  const scope = !unit && (await cgroupCapabilities()).cgroupVersion === 1;
  const launchContext = {
    directory,
    job,
    folder,
    ownership,
    temporaryDirectory,
    temporary: unit ? temporaryDirectory : "/tmp",
    cliPath: unit ? await loginPath() : null,
    unit,
    account,
    scope,
    sshConfig,
    contextProof,
    hostTasks,
  };
  const launcher = unit
    ? {
        file: NATIVE_LAUNCHER,
        args: nativeLaunchArguments(unit, [
          process.execPath,
          fileURLToPath(new URL("./execution.mjs", import.meta.url)),
          "--job",
          folder,
        ]),
      }
    : (() => {
        const namespace = namespaceArguments(launchContext);
        return scope
          ? scopeCommand(job.jobId, namespace)
          : { file: namespace[0], args: namespace.slice(1) };
      })();
  const child = spawn(launcher.file, launcher.args, {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: workerEnvironment(launchContext),
  });
  child.on("error", () => {
    /* The durable claim reconciles as lost if launch never confirms. */
  });
  child.stdin.on("error", () => {});
  try {
    if (!child.pid) throw new Error("Runner supervisor did not start");
    const start = await identity(child.pid);
    if (!start) throw new Error("Runner supervisor identity unavailable");
    const launch = {
      id: randomUUID(),
      processId: child.pid,
      identity: start,
      boundary: unit ? "worker_unit" : "pid_namespace",
      isolationVersion: 1,
      startedAt: Date.now(),
      ...(unit
        ? { unit }
        : {
            parentNamespace,
            ...(scope ? { cgroup: await confirmScope(job.jobId) } : {}),
          }),
    };
    await store(ownershipPath, launch);
    await store(join(folder, "launch.json"), launch);
    const cancellation = await cancellationFor(directory, job);
    if (cancellation) {
      await cancelJob(directory, { ...job, cancellation });
      return;
    }
    child.stdin.end("go\n");
  } catch (error) {
    child.stdin.destroy();
    if (scope) await abortScope(job.jobId);
    if (child.pid) child.kill("SIGKILL");
    if (!child.pid) await removeRunnerTemporaryDirectory(job);
    throw error;
  }
  child.unref();
}

function namespaceArguments(context) {
  const { folder, ownership, temporaryDirectory, account, scope, sshConfig } =
    context;
  return [
    "/usr/bin/bwrap",
    "--unshare-pid",
    "--new-session",
    "--bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--bind",
    temporaryDirectory,
    "/tmp",
    "--tmpfs",
    ownership,
    ...(scope
      ? [
          "--ro-bind",
          "/sys/fs/cgroup",
          "/sys/fs/cgroup",
          "--tmpfs",
          `/run/user/${process.getuid()}`,
        ]
      : []),
    ...(account?.mounts ?? []),
    "--ro-bind",
    "/dev/null",
    join(context.directory, "config.json"),
    ...sshConfig,
    "--",
    process.execPath,
    fileURLToPath(new URL("./execution.mjs", import.meta.url)),
    "--job",
    folder,
  ];
}

function workerEnvironment(context) {
  const {
    directory,
    job,
    account,
    contextProof,
    hostTasks,
    temporary,
    temporaryDirectory,
    cliPath,
    unit,
  } = context;
  return {
    ...(job.execution.program.access === "full_environment" &&
    process.env.PAGES_RUNNER_LOCAL === "1"
      ? process.env
      : {}),
    PAGES_RUNNER_FULL_ENVIRONMENT:
      job.execution.program.access === "full_environment" &&
      process.env.PAGES_RUNNER_LOCAL === "1"
        ? "1"
        : undefined,
    PATH: "/usr/bin:/bin",
    HOME: directory,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    NODE_COMPILE_CACHE: join(temporary, "node-compile-cache"),
    LANG: "C.UTF-8",
    NODE_OPTIONS: "--max-old-space-size=128",
    XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`,
    PAGES_REMOTE_JOB: job.jobId,
    PAGES_RUNNER_LOCAL: process.env.PAGES_RUNNER_LOCAL,
    PAGES_RUNNER_LINKED_PROVIDER: job.execution.program.linkedProvider
      ? "1"
      : undefined,
    PAGES_RUNNER_CLI_HOME:
      account?.home ?? process.env.PAGES_RUNNER_CLI_HOME ?? homedir(),
    PAGES_RUNNER_BROWSER_COMMAND: process.env.PAGES_RUNNER_BROWSER_COMMAND,
    PAGES_RUNNER_BROWSERS_PATH: process.env.PAGES_RUNNER_BROWSERS_PATH,
    PAGES_RUNNER_CLI_PATH:
      cliPath ?? process.env.PAGES_RUNNER_CLI_PATH ?? process.env.PATH,
    ...(account ? { PAGES_RUNNER_AGENT_ACCOUNT: "1" } : {}),
    ...(unit
      ? {
          PAGES_RUNNER_JOB_BOUNDARY: "worker_unit",
          PAGES_RUNNER_TEMPORARY: temporaryDirectory,
        }
      : { PAGES_RUNNER_JOB_NAMESPACE: "1" }),
    PAGES_RUNNER_CONTEXT_PROOF: contextProof,
    ...(hostTasks === null
      ? {}
      : { PAGES_RUNNER_HOST_TASKS: String(hostTasks) }),
    ...(!account && process.env.PAGES_RUNNER_ANTIGRAVITY_HOME
      ? {
          PAGES_RUNNER_ANTIGRAVITY_HOME:
            process.env.PAGES_RUNNER_ANTIGRAVITY_HOME,
        }
      : {}),
    ...(!account && process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT
      ? {
          PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT:
            process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT,
        }
      : {}),
  };
}
