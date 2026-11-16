import { spawn } from "node:child_process";
import os from "node:os";

const STOP_GRACE_MILLISECONDS = 10_000;

/** Exit code of a step that ran into its time limit, as in `timeout(1)`. */
export const TIMEOUT_EXIT_CODE = 124;

/** Exit code of a command whose process could not be started. */
const SETUP_EXIT_CODE = 3;

async function settleProcessGroup(processId) {
  if (!processId) return;
  const began = Date.now();
  while (Date.now() - began < STOP_GRACE_MILLISECONDS + 2000) {
    try {
      process.kill(
        -processId,
        Date.now() - began < STOP_GRACE_MILLISECONDS ? "SIGTERM" : "SIGKILL",
      );
      process.kill(-processId, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw Object.assign(error, { retainTemporaryDirectory: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Object.assign(
    new Error("Command process group did not stop; scratch retained."),
    { retainTemporaryDirectory: true },
  );
}

/**
 * Runs one step to its end; a time limit or a signal is a failure, never a pass.
 * @returns The exit code of the step, {@link TIMEOUT_EXIT_CODE} after its limit.
 */
export function runStep(command, args, options) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve(130);
      return;
    }
    const child = spawn(command, args, {
      detached: true,
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let hasTimedOut = false;
    let killTimer;
    let interruption = null;
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const forward = (signal) => {
      interruption = signal;
      signalGroup(signal);
      killTimer ??= setTimeout(
        () => signalGroup("SIGKILL"),
        STOP_GRACE_MILLISECONDS,
      );
    };
    const interruptTerm = () => forward("SIGTERM");
    const interruptInt = () => forward("SIGINT");
    const abort = () => forward("SIGTERM");
    options.signal?.addEventListener("abort", abort, { once: true });
    const limit = setTimeout(() => {
      hasTimedOut = true;
      signalGroup("SIGTERM");
      killTimer = setTimeout(
        () => signalGroup("SIGKILL"),
        STOP_GRACE_MILLISECONDS,
      );
    }, options.timeoutMilliseconds);
    process.on("SIGINT", interruptInt);
    process.on("SIGTERM", interruptTerm);
    const finish = async (code) => {
      clearTimeout(limit);
      clearTimeout(killTimer);
      process.off("SIGINT", interruptInt);
      process.off("SIGTERM", interruptTerm);
      options.signal?.removeEventListener("abort", abort);
      await settleProcessGroup(child.pid);
      resolve(code);
    };
    let hasSpawnFailed = false;
    child.once("error", () => {
      hasSpawnFailed = true;
    });
    child.once("close", (code, signal) => {
      let result =
        signal === null ? (code ?? 1) : 128 + os.constants.signals[signal];
      if (hasSpawnFailed) result = SETUP_EXIT_CODE;
      else if (hasTimedOut) result = TIMEOUT_EXIT_CODE;
      else if (interruption) result = 128 + os.constants.signals[interruption];
      void finish(result).catch(reject);
    });
  });
}
