import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Where the PostgreSQL 18 packages of this server keep their programs. */
const POSTGRES_PROGRAMS = "/usr/lib/postgresql/18/bin";

// The supervisor owns the direct child and pins it with a pidfd before reporting
// readiness. EOF on the private pipe also stops it if the caller disappears.
const POSTGRES_SUPERVISOR = `
import os, select, signal, subprocess, sys
binary, logfile, *arguments = sys.argv[1:]
os.umask(0o077)
if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
    raise RuntimeError("pidfd process control is unavailable")
with open(logfile, "ab", buffering=0) as log:
    child = subprocess.Popen([binary, *arguments], stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    try:
        descriptor = os.pidfd_open(child.pid, 0)
    except BaseException:
        child.terminate()
        child.wait()
        raise
    try:
        print("owned", flush=True)
        select.select([sys.stdin.fileno(), descriptor], [], [])
    finally:
        if child.poll() is None:
            signal.pidfd_send_signal(descriptor, signal.SIGINT)
        result = child.wait()
        os.close(descriptor)
    sys.exit(0 if result == 0 else 1)
`;

function programPath(name: string): string {
  return path.join(POSTGRES_PROGRAMS, name);
}

/** Preserves explicit caller isolation while excluding ambient credentials and service configuration. */
function postgresProgramEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    LC_ALL: "C.UTF-8",
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PGHOST: process.env.PGHOST,
    PGPORT: process.env.PGPORT,
    PGDATABASE: process.env.PGDATABASE,
    PGUSER: process.env.PGUSER,
    PGPASSFILE: process.env.PGPASSFILE,
    PGSERVICEFILE: process.env.PGSERVICEFILE,
  };
}

/**
 * Runs a program of the PostgreSQL packages and waits until it ended.
 *
 * @param name - The name of the program.
 * @param parameters - Its parameters.
 * @throws When it fails; the message holds what the program printed.
 */
export function runProgram(
  name: string,
  parameters: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(programPath(name), parameters, {
      signal,
      env: postgresProgramEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let failure: Error | null = null;
    child.on("error", (error: Error) => {
      failure = error;
    });
    child.on("close", (code) => {
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`${name} failed:\n${output}`));
    });
  });
}

/**
 * Finds a port nothing listens on at the moment.
 *
 * @returns The port.
 */
export async function freeLoopbackPort(): Promise<number> {
  let port = 55432;
  while (port === 55432) port = await findLoopbackPort();
  return port;
}

function findLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string")
          reject(new Error("The loopback address has no port."));
        else resolve(address.port);
      });
    });
  });
}

/**
 * Finds the processes that name a directory on their command line, as a postmaster does.
 *
 * @param directory - The directory.
 * @returns Their process identifiers, without this process.
 */
export async function processesNaming(
  directory: string,
): Promise<readonly number[]> {
  const entries = await readdir("/proc");
  const found: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/u.test(entry) || Number(entry) === process.pid) continue;
    const commandLine = await readFile(
      path.join("/proc", entry, "cmdline"),
      "utf8",
    ).catch(() => "");
    if (commandLine.includes(directory)) found.push(Number(entry));
  }
  return found;
}

/** A PostgreSQL process tied to a private supervisor and its pidfd. */
export interface OwnedPostgres {
  /** Whether the supervisor still owns a running server. */
  isRunning(): boolean;
  /** Stops and waits for the exact child; never signals a PID from a file. */
  stop(): Promise<void>;
}

/** Arguments for one directly owned PostgreSQL server. */
export interface OwnedPostgresOptions {
  readonly logFile: string;
  readonly arguments: readonly string[];
}

/** Starts a PostgreSQL child and requires a pidfd before returning its owner. */
export async function startOwnedPostgres(
  options: OwnedPostgresOptions,
): Promise<OwnedPostgres> {
  const supervisor: ChildProcessWithoutNullStreams = spawn(
    "python3",
    [
      "-u",
      "-c",
      POSTGRES_SUPERVISOR,
      programPath("postgres"),
      options.logFile,
      ...options.arguments,
    ],
    {
      env: postgresProgramEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  supervisor.stdin.on("error", () => undefined);
  let errors = "";
  supervisor.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString("utf8");
  });
  const exit = new Promise<number | null>((resolve) => {
    supervisor.once("error", () => resolve(null));
    supervisor.once("exit", (code) => resolve(code));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      supervisor.stdout.once("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").trim() === "owned") resolve();
        else reject(new Error("PostgreSQL ownership was not confirmed."));
      });
      supervisor.once("error", reject);
      supervisor.once("exit", () =>
        reject(new Error(`PostgreSQL supervisor failed: ${errors}`)),
      );
    });
  } catch (error: unknown) {
    supervisor.stdin.end();
    await exit;
    throw error;
  }
  let stopping: Promise<void> | null = null;
  return {
    isRunning: () =>
      supervisor.exitCode === null && supervisor.signalCode === null,
    stop: () => {
      stopping ??= (async () => {
        supervisor.stdin.end();
        if ((await exit) !== 0)
          throw new Error("The owned PostgreSQL server did not stop cleanly.");
      })();
      return stopping;
    },
  };
}

