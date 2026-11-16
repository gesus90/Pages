import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readRecord, store } from "./journal.mjs";
import { privateUpdateDirectory, rollbackRunnerUpdate } from "./update.mjs";

/** Stable parent process; a failed candidate never replaces the last working release. */
export async function superviseRunner(options = {}) {
  const directory =
    options.directory ??
    process.env.PAGES_RUNNER_DIRECTORY ??
    join(homedir(), ".config", "pages-runner");
  const initial =
    options.initial ??
    join(dirname(fileURLToPath(import.meta.url)), "transport.mjs");
  await privateUpdateDirectory(directory);
  let isStopping = false;
  let child;
  const stop = (signal) => {
    isStopping = true;
    child?.kill(signal);
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    while (!isStopping) {
      const active = await readRecord(join(directory, "active-release.json"));
      if (active && !/^[a-f0-9]{64}-[a-f0-9-]{36}$/u.test(active.release))
        throw new Error("Invalid runner release pointer");
      const entry = active
        ? join(directory, "releases", active.release, "transport.mjs")
        : initial;
      const shouldVerify =
        active?.pending && !process.argv.includes("--version");
      const result = await new Promise((resolve, reject) => {
        child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
          stdio: "inherit",
          env: {
            ...process.env,
            PAGES_RUNNER_SUPERVISED: "1",
            PAGES_RUNNER_RELEASE: active?.release ?? "",
          },
        });
        let killTimer;
        const timer = shouldVerify
          ? setTimeout(() => {
              child.kill("SIGTERM");
              killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
            }, 60000)
          : undefined;
        const health = shouldVerify
          ? setInterval(() => {
              void readRecord(join(directory, "release-health.json"))
                .then((receipt) => {
                  if (
                    receipt?.release === active.release &&
                    receipt.version === active.version
                  ) {
                    clearTimeout(timer);
                    clearInterval(health);
                  }
                })
                .catch((error) =>
                  console.error(
                    "Runner health receipt unreadable:",
                    error.code ?? error.name,
                  ),
                );
            }, 250)
          : undefined;
        child.once("error", (error) => {
          clearTimeout(timer);
          clearInterval(health);
          clearTimeout(killTimer);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          clearInterval(health);
          clearTimeout(killTimer);
          resolve({ code, signal });
        });
      });
      if (isStopping) return;
      if (process.argv.includes("--version")) {
        process.exitCode = result.code ?? 1;
        return;
      }
      const health = await readRecord(join(directory, "release-health.json"));
      if (
        active?.pending &&
        (health?.release !== active.release ||
          health.version !== active.version)
      ) {
        await rollbackRunnerUpdate(directory, active);
        continue;
      }
      if (active?.pending) {
        const current = await readRecord(
          join(directory, "active-release.json"),
        );
        if (current?.release === active.release)
          await store(join(directory, "active-release.json"), {
            ...active,
            pending: false,
          });
      }
      if (result.code === 75) continue;
      process.exitCode = result.code ?? 1;
      return;
    }
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await superviseRunner();
