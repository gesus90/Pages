import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Owns command scratch through success, failure and catchable termination.
 * The callback must settle its children before returning; signals abort its
 * work instead of deleting files underneath running processes.
 */
export async function withCommandTemporaryDirectory(run) {
  const root =
    process.env.TMPDIR || path.join(homedir(), ".pages", "data", "check-tmp");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(root, "pages-command-"));
  const names = ["TMPDIR", "TEMP", "TMP", "NODE_COMPILE_CACHE"];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    TMPDIR: directory,
    TEMP: directory,
    TMP: directory,
    NODE_COMPILE_CACHE: path.join(directory, "node-compile-cache"),
  });
  const controller = new AbortController();
  const interrupt = (signal) => {
    process.exitCode = signal === "SIGTERM" ? 143 : 130;
    controller.abort(new Error(`Command interrupted by ${signal}`));
  };
  const interruptTerm = () => interrupt("SIGTERM");
  const interruptInt = () => interrupt("SIGINT");
  process.on("SIGTERM", interruptTerm);
  process.on("SIGINT", interruptInt);
  let shouldRetain = false;
  try {
    return await run({ directory, signal: controller.signal });
  } catch (error) {
    shouldRetain = error?.retainTemporaryDirectory === true;
    throw error;
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    try {
      if (shouldRetain)
        console.error(
          `Command processes remain; scratch retained at ${directory}`,
        );
      else await rm(directory, { recursive: true, force: true });
    } finally {
      process.off("SIGTERM", interruptTerm);
      process.off("SIGINT", interruptInt);
    }
  }
}
