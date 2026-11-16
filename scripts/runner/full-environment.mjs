import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const SERVICE_VARIABLES = new Set([
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "NOTIFY_SOCKET",
  "WATCHDOG_PID",
  "WATCHDOG_USEC",
  "JOURNAL_STREAM",
  "MEMORY_PRESSURE_WATCH",
  "MEMORY_PRESSURE_WRITE",
  "LISTEN_PID",
  "LISTEN_FDS",
  "LISTEN_FDNAMES",
  "MAINPID",
  "MANAGERPID",
]);

/** Preserves the authorized host owner's login environment inside the runner-owned worker. */
export async function fullEnvironmentContext(command, signal) {
  if (command.program.access !== "full_environment") return null;
  if (
    process.env.PAGES_RUNNER_LOCAL !== "1" ||
    !command.managed?.ownerId ||
    command.managed.ownerId !== process.env.PAGES_FULL_ENVIRONMENT_OWNER_ID
  )
    throw Object.assign(new Error("Host owner unavailable"), {
      failureCode: "plan_full_environment_forbidden",
    });
  const owner = userInfo();
  if (owner.uid < 1 || !owner.shell) throw new Error("Host owner unavailable");
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, entry]) => entry !== undefined && !SERVICE_VARIABLES.has(name),
    ),
  );
  let result;
  try {
    result = await runFile(owner.shell, ["-lc", "exec /usr/bin/env -0"], {
      cwd: command.workspace,
      env: {
        ...inherited,
        HOME: owner.homedir,
        USER: owner.username,
        LOGNAME: owner.username,
        SHELL: owner.shell,
      },
      signal,
      timeout: 10000,
      maxBuffer: 1048576,
    });
  } catch {
    throw Object.assign(new Error("Host owner unavailable"), {
      failureCode: "plan_full_environment_owner_unavailable",
    });
  }
  const environment = {};
  for (const entry of result.stdout.split("\0")) {
    const separator = entry.indexOf("=");
    const name = entry.slice(0, separator);
    if (
      separator > 0 &&
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) &&
      !SERVICE_VARIABLES.has(name)
    )
      environment[name] = entry.slice(separator + 1);
  }
  if (!environment.PATH) throw new Error("Host login PATH unavailable");
  environment.HOME = owner.homedir;
  const secrets = Object.entries(environment)
    .filter(
      ([name, entry]) =>
        /token|secret|password|credential|api_?key|private_?key/iu.test(name) &&
        entry.length >= 8,
    )
    .map(([, entry]) => entry);
  return { environment, secrets };
}
