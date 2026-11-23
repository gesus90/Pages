import { randomBytes } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import {
  freeLoopbackPort,
  processesNaming,
  runProgram,
  startOwnedPostgres,
} from "../postgres-restore-check/postgres-programs";

import type { OwnedPostgres } from "../postgres-restore-check/postgres-programs";

/** The PostgreSQL major version of the suite; the programs come from its packages. */
export const POSTGRES_MAJOR_VERSION = 18;

/** Every run directory starts with this name, so a leftover is recognizable. */
const RUN_DIRECTORY_PREFIX = "run-";

const ADMIN_ROLE = "pages_integration_admin";

/** The role of `databaseUrl` on a Pages installation: no superuser rights. */
const APPLICATION_ROLE = "pages_integration";

const START_TIMEOUT_MS = 60_000;

const START_POLL_MS = 100;

const DATABASE_NAME = /^[a-z][a-z0-9_]{0,40}$/u;

/**
 * Only the loopback port is open and every login needs a password; the
 * private socket stays off so that no long path limits the run directory.
 */
function serverSettings(port: number): string {
  return [
    "",
    `port = ${String(port)}`,
    "listen_addresses = '127.0.0.1'",
    "unix_socket_directories = ''",
    "max_connections = 50",
    "shared_buffers = '64MB'",
    // The data is thrown away with the run, so a crash needs no durability.
    "fsync = off",
    "full_page_writes = off",
    "",
  ].join("\n");
}

/**
 * One throwaway PostgreSQL server of a single run, with its own data
 * directory below the private temporary folder of Pages.
 * @remarks
 * Nothing of an installed PostgreSQL is used or changed: the server listens
 * on a free loopback port, holds its own roles and passwords, and the
 * whole directory is removed at the end of the run, successful or not.
 */
export class IntegrationCluster {
  private readonly runDirectory: string;
  private readonly port: number;
  private readonly adminPassword = randomBytes(24).toString("hex");
  private readonly applicationPassword = randomBytes(24).toString("hex");
  private owner: OwnedPostgres | null = null;
  private isRoleCreated = false;
  private removal: Promise<void> | null = null;

  private constructor(runDirectory: string, port: number) {
    this.runDirectory = runDirectory;
    this.port = port;
  }

  /**
   * Creates the private run directory and picks the port.
   * @param rootDirectory - The folder to create the run directory in.
   * @returns The cluster, which owes a {@link remove} from now on.
   */
  public static async prepare(
    rootDirectory: string,
  ): Promise<IntegrationCluster> {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    return new IntegrationCluster(
      await mkdtemp(path.join(rootDirectory, RUN_DIRECTORY_PREFIX)),
      await freeLoopbackPort(),
    );
  }

  /**
   * Initializes the data directory and starts the server.
   * @throws When `initdb` fails or the server does not accept connections in time.
   */
  public async start(): Promise<void> {
    const passwordFile = path.join(this.runDirectory, "admin-password");
    await writeFile(passwordFile, this.adminPassword, { mode: 0o600 });
    await runProgram("initdb", [
      "--pgdata",
      this.dataDirectory(),
      "--username",
      ADMIN_ROLE,
      "--pwfile",
      passwordFile,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C.UTF-8",
      "--locale-provider=libc",
    ]);
    await appendFile(
      path.join(this.dataDirectory(), "postgresql.conf"),
      serverSettings(this.port),
    );
    this.owner = await startOwnedPostgres({
      arguments: ["-D", this.dataDirectory()],
      logFile: this.serverLog(),
    });
    await this.waitUntilAccepting();
  }

  /**
   * Reads the version the server reports.
   * @returns The server version text and its number, such as `180006`.
   */
  public async serverVersion(): Promise<{
    readonly text: string;
    readonly number: number;
  }> {
    return this.admin("postgres", async (client) => {
      const result = await client.query<{ text: string; number: string }>(
        "SELECT version() AS text, current_setting('server_version_num') AS number",
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("The server reported no version.");
      return { text: row.text, number: Number(row.number) };
    });
  }

  /**
   * Creates an empty database with the locale Pages requires, owned by a role
   * without superuser rights.
   * @param name - Lower-case name of the database.
   * @returns The private address of the database for that role.
   */
  public async createDatabase(name: string): Promise<string> {
    if (!DATABASE_NAME.test(name))
      throw new Error("A database of the suite has a lower-case name.");
    await this.admin("postgres", async (client) => {
      if (!this.isRoleCreated) {
        await client.query(
          `CREATE ROLE ${APPLICATION_ROLE} LOGIN PASSWORD '${this.applicationPassword}'`,
        );
        this.isRoleCreated = true;
      }
      await client.query(
        `CREATE DATABASE "${name}" OWNER ${APPLICATION_ROLE} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C.UTF-8'`,
      );
    });
    return this.databaseUrl(APPLICATION_ROLE, this.applicationPassword, name);
  }

  /**
   * Stops the server and removes the run directory with every database in it.
   * @param logTarget - Where the server log is kept; it is the only thing that stays.
   * @returns The one removal, also when a signal and the regular end both ask for it.
   * @throws When the server did not stop or a process of the run remains.
   */
  public remove(logTarget: string): Promise<void> {
    this.removal ??= this.stopAndRemove(logTarget);
    return this.removal;
  }

  private async stopAndRemove(logTarget: string): Promise<void> {
    let failure: unknown = null;
    try {
      await this.owner?.stop();
      const remaining = await processesNaming(this.runDirectory);
      if (remaining.length > 0)
        throw new Error(
          `Processes of the run remain: ${remaining.join(", ")}.`,
        );
    } catch (error: unknown) {
      failure = error;
    }
    await copyFile(this.serverLog(), logTarget).catch(() => undefined);
    await rm(this.runDirectory, { recursive: true, force: true });
    if (failure !== null) throw failure;
  }

  private async waitUntilAccepting(): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.owner?.isRunning())
        throw new Error(
          "The PostgreSQL server of the run ended while starting.",
        );
      try {
        await runProgram("pg_isready", [
          "--host=127.0.0.1",
          `--port=${String(this.port)}`,
          "--quiet",
        ]);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
      }
    }
    throw new Error("The PostgreSQL server of the run did not start in time.");
  }

  private databaseUrl(role: string, password: string, name: string): string {
    return `postgresql://${role}:${password}@127.0.0.1:${String(this.port)}/${name}`;
  }

  private async admin<Result>(
    databaseName: string,
    work: (client: Client) => Promise<Result>,
  ): Promise<Result> {
    const client = new Client({
      connectionString: this.databaseUrl(
        ADMIN_ROLE,
        this.adminPassword,
        databaseName,
      ),
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  private dataDirectory(): string {
    return path.join(this.runDirectory, "data");
  }

  private serverLog(): string {
    return path.join(this.runDirectory, "server.log");
  }
}
