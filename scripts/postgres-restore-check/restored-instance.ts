import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  freeLoopbackPort,
  processesNaming,
  runProgram,
  startOwnedPostgres,
} from "../postgres-check/temporary-instance";
import { WORK_DIRECTORY_PREFIX } from "./backup-location";
import { RestoreCheckFailure } from "./restore-check-failure";

import type { OwnedPostgres } from "../postgres-check/temporary-instance";

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
 * A retained copy of a base backup, recovered to a point in time.
 *
 * @remarks
 * It works on a copy, so the backup stays as it is. The work copy is retained.
 */
export class RestoredInstance {
  private readonly workDirectory: string;
  private readonly port: number;
  private copying: Promise<void> | null = null;
  private removal: Promise<void> | null = null;
  private owner: OwnedPostgres | null = null;

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
   * The process owner is acquired before waiting for promotion. With
   * `hot_standby = off`, the server accepts connections only after promotion.
   *
   * @throws {RestoreCheckFailure} When the server ends first, for example because
   * a WAL file is missing or damaged, so the target stays out of reach.
   */
  public async recover(): Promise<void> {
    if (this.removal !== null)
      throw new RestoreCheckFailure("recovery", "The check is ending.");
    try {
      this.owner = await startOwnedPostgres({
        arguments: ["-D", this.dataDirectory()],
        logFile: this.serverLog(),
      });
    } catch {
      throw await this.recoveryFailure();
    }
    await this.waitUntilAccepting();
  }

  /**
   * Stops the server and retains the work directory for inspection.
   *
   * @returns The one removal, also when a signal and the regular end both ask for it.
   * @throws When the owned process did not stop cleanly.
   */
  public remove(): Promise<void> {
    this.removal ??= this.stopAndPreserve();
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
      if (!this.owner?.isRunning()) throw await this.recoveryFailure();
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

  private async stopAndPreserve(): Promise<void> {
    // Let any in-flight copy finish before stopping its owned server.
    await this.copying?.catch(() => undefined);
    await this.stop();
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

  private async stop(): Promise<void> {
    if (this.owner === null) return;
    await this.owner.stop();
    this.owner = null;
  }
}
