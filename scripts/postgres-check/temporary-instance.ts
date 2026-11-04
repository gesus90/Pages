import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

/** Where the PostgreSQL 18 packages of this server keep their programs. */
const POSTGRES_PROGRAMS = "/usr/lib/postgresql/18/bin";
const REQUIRED_PROGRAMS = ["initdb", "pg_ctl"] as const;

const USER_NAME = "pages_check";
const DATABASE_NAME = "postgres";
const START_TIMEOUT_SECONDS = "30";
const STOP_POLLS = 50;
const STOP_POLL_MS = 100;

/** Raised when the programs are missing; it needs a message, not a stack. */
export class PostgresProgramsMissingError extends Error {
  public constructor(missing: readonly string[]) {
    super(
      `postgres:check needs ${missing.join(" and ")} in ${POSTGRES_PROGRAMS}. Install the PostgreSQL 18 server programs; the service itself stays off.`,
    );
    this.name = "PostgresProgramsMissingError";
  }
}

function programPath(name: string): string {
  return path.join(POSTGRES_PROGRAMS, name);
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(programPath(name), parameters, {
      env: { PATH: process.env.PATH, LC_ALL: "C.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    // Not `close`: the server `pg_ctl` starts may hold the streams open.
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} failed:\n${output}`));
    });
  });
}

/**
 * Finds a port nothing listens on at the moment.
 *
 * @returns The port.
 */
export function freeLoopbackPort(): Promise<number> {
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
 * Tells whether a process exists.
 *
 * @param pid - The process identifier.
 * @returns Whether it exists.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends a server that refused a regular stop; a second signal leaves it no choice.
 *
 * @param pid - The process identifier of the server.
 */
export async function endProcess(pid: number): Promise<void> {
  process.kill(pid, "SIGQUIT");
  for (let attempt = 0; attempt < STOP_POLLS; attempt += 1) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  process.kill(pid, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
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

/**
 * Makes sure this server has the programs of the check.
 *
 * @throws {PostgresProgramsMissingError} When one of them is missing.
 */
export async function requirePostgresPrograms(): Promise<void> {
  const missing: string[] = [];
  for (const name of REQUIRED_PROGRAMS)
    if (!(await pathExists(programPath(name)))) missing.push(name);
  if (missing.length > 0) throw new PostgresProgramsMissingError(missing);
}

/**
 * A PostgreSQL server of its own in a temporary directory, on a free loopback
 * port, with password authentication; nothing of it outlives {@link remove}.
 */
export class TemporaryPostgres {
  /** Temporary directory, also the home of the logs of the check. */
  public readonly directory: string;
  private readonly port: number;
  private readonly password: string;
  private postmasterPid: number | null = null;

  private constructor(directory: string, port: number, password: string) {
    this.directory = directory;
    this.port = port;
    this.password = password;
  }

  /**
   * Creates the temporary directory; {@link start} runs the server in it.
   *
   * @returns The instance, which owes a {@link remove} from now on.
   */
  public static async prepare(): Promise<TemporaryPostgres> {
    return new TemporaryPostgres(
      await mkdtemp(path.join(tmpdir(), "pages-postgres-check-")),
      await freeLoopbackPort(),
      randomBytes(24).toString("hex"),
    );
  }

  /** The correct connection URL. */
  public get url(): string {
    return this.urlWith(this.password);
  }

  /**
   * A connection URL with another password.
   *
   * @param password - The password of the URL.
   * @returns The URL.
   */
  public urlWith(password: string): string {
    return `postgresql://${USER_NAME}:${password}@127.0.0.1:${String(this.port)}/${DATABASE_NAME}`;
  }

  /**
   * The correct connection URL of another database of this server.
   *
   * @param databaseName - The name of the database.
   * @returns The URL.
   */
  public urlOfDatabase(databaseName: string): string {
    return `postgresql://${USER_NAME}:${this.password}@127.0.0.1:${String(this.port)}/${databaseName}`;
  }

  /** Creates the cluster and starts its server. */
  public async start(): Promise<void> {
    const data = this.dataDirectory();
    const passwordFile = path.join(this.directory, "password");
    await writeFile(passwordFile, this.password, { mode: 0o600 });
    await runProgram("initdb", [
      `--pgdata=${data}`,
      `--username=${USER_NAME}`,
      `--pwfile=${passwordFile}`,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C.UTF-8",
    ]);
    await rm(passwordFile);
    await runProgram("pg_ctl", [
      "start",
      "--wait",
      `--timeout=${START_TIMEOUT_SECONDS}`,
      `--pgdata=${data}`,
      `--log=${this.serverLog}`,
      `--options=-p ${String(this.port)} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${this.directory}`,
    ]);
    const pidFile = await readFile(path.join(data, "postmaster.pid"), "utf8");
    this.postmasterPid = Number(pidFile.split("\n")[0]);
  }

  /** The log file of the server, which the check searches for the URL as well. */
  public get serverLog(): string {
    return path.join(this.directory, "server.log");
  }

  /**
   * Stops the server and deletes the directory, and proves that both are gone.
   *
   * @throws When a process or the directory remains.
   */
  public async remove(): Promise<void> {
    await this.stop();
    await rm(this.directory, { recursive: true, force: true });
    const remaining = await processesNaming(this.directory);
    if (this.postmasterPid !== null && isProcessAlive(this.postmasterPid))
      throw new Error("The PostgreSQL server of the check is still running.");
    if (remaining.length > 0)
      throw new Error(
        `Processes of the check remain: ${remaining.join(", ")}.`,
      );
    if (await pathExists(this.directory))
      throw new Error("The temporary directory of the check remains.");
  }

  private dataDirectory(): string {
    return path.join(this.directory, "data");
  }

  private async stop(): Promise<void> {
    if (this.postmasterPid === null) return;
    try {
      await runProgram("pg_ctl", [
        "stop",
        "--wait",
        "--mode=fast",
        `--pgdata=${this.dataDirectory()}`,
      ]);
    } catch (error: unknown) {
      console.error("pg_ctl stop failed; ending the server directly.", error);
      if (isProcessAlive(this.postmasterPid))
        await endProcess(this.postmasterPid);
    }
  }
}
