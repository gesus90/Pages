import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";

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

function hostTaskCount() {
  const count = Number(process.env.PAGES_RUNNER_HOST_TASKS);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Host task count unavailable");
  return count;
}

/** Runs the checked script under the existing per-process resource limits. */
export function spawnScript(command, folder, jobId) {
  const accountTaskCount = hostTaskCount();
  const runtime = join(folder, "runtime");
  const interpreter = command.program.interpreter;
  const nodeArguments =
    interpreter.id === "node" ? ["--jitless", "--max-old-space-size=128"] : [];
  const limits = [
    `--cpu=${command.timeoutSeconds + 1}`,
    `--nproc=${accountTaskCount + SCRIPT_TASK_HEADROOM}`,
    "--nofile=128",
    "--fsize=10485760",
    "--core=0",
  ];
  limits.push(interpreter.id === "node" ? "--as=1073741824" : "--as=536870912");
  return spawn(
    "/usr/bin/prlimit",
    [
      ...limits,
      "--",
      interpreter.path,
      ...nodeArguments,
      join(
        runtime,
        interpreter.id === "node" ? "node-guard.cjs" : "source.cjs",
      ),
    ],
    {
      cwd: command.workspace,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: runtime,
        TMPDIR: "/tmp",
        TEMP: "/tmp",
        TMP: "/tmp",
        NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PAGES_REMOTE_JOB: jobId,
      },
    },
  );
}
