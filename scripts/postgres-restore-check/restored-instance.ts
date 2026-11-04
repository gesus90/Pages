import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  endProcess,
  freeLoopbackPort,
  isProcessAlive,
  processesNaming,
  runProgram,
} from "../postgres-check/temporary-instance";
import { WORK_DIRECTORY_PREFIX } from "./backup-location";
import { RestoreCheckFailure } from "./restore-check-failure";

/** Replaying a day of WAL can take long; a failed recovery ends the server at once. */
const RECOVERY_TIMEOUT_SECONDS = 3600;

const RECOVERY_POLL_MS = 100;

const FAILURE_LINE = /\b(?:FATAL|PANIC):/u;

/** What the server answers to the waiting below; it says nothing about the recovery. */
const WAITING_LINE = /not (?:yet )?accepting connections|is starting up/u;

/**
 * Only the private socket gets in, and without a password: the role and its password
 * come from the source. The port stays closed to everyone, since this is real data.
 */
const ACCESS_RULES = "local all all trust\nhost all all all reject\n";

/** What recovery needs to find its WAL and where to stop. */
export interface RecoveryPlan {
  readonly walDirectory: string;
  readonly targetTime: string;
}

function quoteConfigText(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function quoteShellWord(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** A `%` of the path would otherwise count as a placeholder of `restore_command`. */
function restoreCommand(walDirectory: string): string {
  const directory = quoteShellWord(walDirectory.replaceAll("%", "%%"));
  return `cp ${directory}/%f %p`;
}

/**
 * The whole configuration of the instance.
 *
 * @remarks
 * Nothing of the source survives here. `archive_mode` above all: an instance that
 * archives would put its own WAL into the archive of the source.
 */
function serverSettings(
  plan: RecoveryPlan,
  port: number,
  socketDirectory: string,
): string {
  return [
    `port = ${String(port)}`,
    "listen_addresses = '127.0.0.1'",
    `unix_socket_directories = ${quoteConfigText(socketDirectory)}`,
    "unix_socket_permissions = 0700",
    "archive_mode = off",
    `restore_command = ${quoteConfigText(restoreCommand(plan.walDirectory))}`,
    `recovery_target_time = ${quoteConfigText(plan.targetTime)}`,
    "recovery_target_inclusive = on",
    "recovery_target_timeline = 'latest'",
    "recovery_target_action = 'promote'",
    // Without connections during recovery, the limits of the source do not apply.
    "hot_standby = off",
    "max_connections = 20",
    "max_wal_senders = 0",
    "shared_buffers = '128MB'",
    "autovacuum = off",
    "fsync = off",
    "",
  ].join("\n");
}

/**
 * A throwaway copy of a base backup, recovered to a point in time.
 *
 * @remarks
 * It works on a copy, so the backup stays as it is. Nothing of it outlives
 * {@link remove}.
 */
export class RestoredInstance {
  private readonly workDirectory: string;
  private readonly port: number;
  private copying: Promise<void> | null = null;
  private removal: Promise<void> | null = null;

  private constructor(workDirectory: string, port: number) {
    this.workDirectory = workDirectory;
    this.port = port;
  }

  /**
   * Creates the private work directory.
   *
   * @param rootDirectory - The directory to create it in.
   * @returns The instance, which owes a {@link remove} from now on.
   */
  public static async prepare(
    rootDirectory: string,
  ): Promise<RestoredInstance> {
    return new RestoredInstance(
      await mkdtemp(path.join(rootDirectory, WORK_DIRECTORY_PREFIX)),
      await freeLoopbackPort(),
    );
  }

  /**
   * The URL of this instance, for a role and a database of the source.
   *
   * @param sourceUrl - The connection URL of the source.
   * @returns The URL through the private socket.
   */
  public urlFor(sourceUrl: string): string {
    const { username, pathname } = new URL(sourceUrl);
    const socket = encodeURIComponent(this.socketDirectory());
    return `postgresql://${username}@localhost:${String(this.port)}${pathname}?host=${socket}`;
  }

  /**
   * Copies a base backup and sets it up for recovery.
   *
   * @param baseBackup - The directory of the backup.
   * @param plan - Where the WAL lies and where to stop.
   */
  public copyFrom(baseBackup: string, plan: RecoveryPlan): Promise<void> {
    this.copying = this.copyAndConfigure(baseBackup, plan);
    return this.copying;
  }

  /**
   * Starts the server and waits until recovery reached its target and promoted.
   *
   * @remarks
   * `pg_ctl --wait` is not enough: in PostgreSQL 18 it can return while recovery
   * still runs, and a connection then fails with `57P03`. With `hot_standby = off`
   * the server accepts connections only after it promoted.
   *
   * @throws {RestoreCheckFailure} When the server ends first, for example because
   * a WAL file is missing or damaged, so the target stays out of reach.
   */
  public async recover(): Promise<void> {
    if (this.removal !== null)
      throw new RestoreCheckFailure("recovery", "The check is ending.");
    try {
      await runProgram("pg_ctl", [
        "start",
        "--wait",
        `--timeout=${String(RECOVERY_TIMEOUT_SECONDS)}`,
        `--pgdata=${this.dataDirectory()}`,
        `--log=${this.serverLog()}`,
      ]);
    } catch {
      throw await this.recoveryFailure();
    }
    await this.waitUntilAccepting();
  }

  /**
   * Stops the server and deletes the work directory, and proves both are gone.
   *
   * @returns The one removal, also when a signal and the regular end both ask for it.
   * @throws When a process or the directory remains.
   */
  public remove(): Promise<void> {
    this.removal ??= this.stopAndDelete();
    return this.removal;
  }

  private async copyAndConfigure(
    baseBackup: string,
    plan: RecoveryPlan,
  ): Promise<void> {
    const directory = this.dataDirectory();
    await cp(baseBackup, directory, {
      recursive: true,
      verbatimSymlinks: true,
    });
    await chmod(directory, 0o700);
    await mkdir(this.socketDirectory(), { mode: 0o700 });
    await writeFile(
      path.join(directory, "postgresql.conf"),
      serverSettings(plan, this.port, this.socketDirectory()),
    );
    // It would win over the file above and can name an `archive_command`.
    await writeFile(path.join(directory, "postgresql.auto.conf"), "");
    await writeFile(path.join(directory, "pg_hba.conf"), ACCESS_RULES);
    await writeFile(path.join(directory, "pg_ident.conf"), "");
    await writeFile(path.join(directory, "recovery.signal"), "");
  }

  private async waitUntilAccepting(): Promise<void> {
    const deadline = Date.now() + RECOVERY_TIMEOUT_SECONDS * 1000;
    while (Date.now() < deadline) {
      if (await this.isAccepting()) return;
      const pid = await this.readPostmasterPid();
      if (pid === null || !isProcessAlive(pid))
        throw await this.recoveryFailure();
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_POLL_MS));
    }
    throw await this.recoveryFailure();
  }

  private async isAccepting(): Promise<boolean> {
    try {
      await runProgram("pg_isready", [
        `--host=${this.socketDirectory()}`,
        `--port=${String(this.port)}`,
        "--quiet",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private async recoveryFailure(): Promise<RestoreCheckFailure> {
    return new RestoreCheckFailure(
      "recovery",
      `The recovery failed. ${await this.readFailureLines()}`,
    );
  }

  private async stopAndDelete(): Promise<void> {
    // A copy in progress would write into the directory while it is deleted.
    await this.copying?.catch(() => undefined);
    await this.stop();
    await rm(this.workDirectory, { recursive: true, force: true });
    const remaining = await processesNaming(this.workDirectory);
    if (remaining.length > 0)
      throw new Error(
        `Processes of the check remain: ${remaining.join(", ")}.`,
      );
  }

  private dataDirectory(): string {
    return path.join(this.workDirectory, "data");
  }

  private socketDirectory(): string {
    return path.join(this.workDirectory, "socket");
  }

  private serverLog(): string {
    return path.join(this.workDirectory, "server.log");
  }

  private async readFailureLines(): Promise<string> {
    const log = await readFile(this.serverLog(), "utf8").catch(() => "");
    return log
      .split("\n")
      .filter((line) => FAILURE_LINE.test(line) && !WAITING_LINE.test(line))
      .join(" ");
  }

  private async readPostmasterPid(): Promise<number | null> {
    const file = await readFile(
      path.join(this.dataDirectory(), "postmaster.pid"),
      "utf8",
    ).catch(() => null);
    return file === null ? null : Number(file.split("\n")[0]);
  }

  /** Immediate: the data is thrown away, so a clean shutdown protects nothing. */
  private async stop(): Promise<void> {
    const pid = await this.readPostmasterPid();
    if (pid === null) return;
    try {
      await runProgram("pg_ctl", [
        "stop",
        "--wait",
        "--mode=immediate",
        `--pgdata=${this.dataDirectory()}`,
      ]);
    } catch (error: unknown) {
      console.error("pg_ctl stop failed; ending the server directly.", error);
      if (isProcessAlive(pid)) await endProcess(pid);
    }
  }
}
