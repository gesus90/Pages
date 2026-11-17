import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";

import { interpreters } from "./interpreters.mjs";

/** Rechecks the interpreter digest before writing the private source and Node guard. */
export async function prepareScript(command, runtime) {
  const profile = (await interpreters()).find(
    (entry) => entry.id === command.program.interpreter.id,
  );
  if (
    !profile ||
    profile.path !== command.program.interpreter.path ||
    profile.digest !== command.program.interpreter.digest
  )
    throw Object.assign(new Error("Interpreter changed"), {
      failureCode: "plan_script_interpreter_unavailable",
    });
  const script = await open(join(runtime, "source.cjs"), "wx", 0o600);
  try {
    await script.writeFile(command.program.source);
    await script.sync();
  } finally {
    await script.close();
  }
  if (profile.id === "node") {
    const guard = await open(join(runtime, "node-guard.cjs"), "wx", 0o600);
    try {
      await guard.writeFile(
        'if (typeof WebAssembly !== "undefined") process.exit(1);\nrequire("./source.cjs");\n',
      );
      await guard.sync();
    } finally {
      await guard.close();
    }
  }
}

// RLIMIT_NPROC counts all threads of the account, so a fixed 128 fails every fork
// as soon as parallel agents run; scripts get this headroom above current use.
const SCRIPT_TASK_HEADROOM = 256;

// Leave virtual address space for V8 reservations, native libraries and child
// interpreters beyond the four-GiB Node heap used by project checks.
const SCRIPT_ADDRESS_SPACE_BYTES = 6 * 1024 * 1024 * 1024;

// Every Node process of a script runs under the policy of the Node interpreter
// profile, also when a Bash or Python script starts it, and it fits the limit above.
const SCRIPT_NODE_FLAGS = ["--jitless", "--max-old-space-size=4096"];

const SCRIPT_SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin"];

function hostTaskCount() {
  const count = Number(process.env.PAGES_RUNNER_HOST_TASKS);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Host task count unavailable");
  return count;
}

/**
 * The tool search path of a script: the directory of the Node interpreter the
 * catalog advertises, then the system directories.
 *
 * Node is usually installed by a version manager outside the system
 * directories, so the catalog lists it by absolute path but a bare `node` in a
 * Bash or Python script would not resolve. Only the directory of the runner's
 * own executable is added; the runner's login PATH is never inherited.
 */
export function scriptSearchPath(nodeExecutable = process.execPath) {
  const directory = dirname(nodeExecutable);
  const isUsable =
    isAbsolute(nodeExecutable) &&
    !directory.includes(delimiter) &&
    !SCRIPT_SYSTEM_PATH.includes(directory);
  return [...(isUsable ? [directory] : []), ...SCRIPT_SYSTEM_PATH].join(
    delimiter,
  );
}

/** The complete environment of a script; nothing is inherited from the runner service. */
export function scriptEnvironment(runtime, jobId, nodeExecutable) {
  return {
    PATH: scriptSearchPath(nodeExecutable),
    HOME: runtime,
    TMPDIR: "/tmp",
    TEMP: "/tmp",
    TMP: "/tmp",
    NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
    NODE_OPTIONS: SCRIPT_NODE_FLAGS.join(" "),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PAGES_REMOTE_JOB: jobId,
  };
}

/** The per-process limits of a script; they are shared by Bash, Python and Node. */
export function scriptLimits(timeoutSeconds, accountTaskCount) {
  return [
    `--cpu=${timeoutSeconds + 1}`,
    `--nproc=${accountTaskCount + SCRIPT_TASK_HEADROOM}`,
    "--nofile=128",
    "--fsize=10485760",
    "--core=0",
    `--as=${SCRIPT_ADDRESS_SPACE_BYTES}`,
  ];
}

/** Runs the checked script under the existing per-process resource limits. */
export function spawnScript(command, folder, jobId) {
  const accountTaskCount = hostTaskCount();
  const runtime = join(folder, "runtime");
  const interpreter = command.program.interpreter;
  const isNode = interpreter.id === "node";
  return spawn(
    "/usr/bin/prlimit",
    [
      ...scriptLimits(command.timeoutSeconds, accountTaskCount),
      "--",
      interpreter.path,
      ...(isNode ? SCRIPT_NODE_FLAGS : []),
      join(runtime, isNode ? "node-guard.cjs" : "source.cjs"),
    ],
    {
      cwd: command.workspace,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: scriptEnvironment(runtime, jobId),
    },
  );
}
