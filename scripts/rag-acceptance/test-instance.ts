import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { Client } from "pg";

import { Database } from "../../backend/database/Database";
import { readMigrations } from "../read-database-migrations";

/** Every database and role of the acceptance starts with this name, and only those are ever dropped. */
const NAME_PREFIX = "pages_rag_acceptance_";

/** Hosts of a disposable instance on this machine; no data leaves it. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Dump entries of pgvector; the role of `databaseUrl` cannot restore them. */
const EXTENSION_ENTRIES = /EXTENSION - vector|COMMENT - EXTENSION vector/;

/** A database of the acceptance and the private address of its role. */
export interface AcceptanceDatabase {
  readonly name: string;
  readonly url: string;
}

/** Output of a finished program. */
interface ProgramResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a PostgreSQL program with the password in its environment, never in an argument.
 * @param program - `pg_dump` or `pg_restore` of the PATH.
 * @param options - Arguments, password and optional standard input.
 * @returns Exit code and output.
 */
async function runProgram(
  program: string,
  options: {
    readonly arguments: readonly string[];
    readonly password: string;
  },
): Promise<ProgramResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, [...options.arguments], {
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C.UTF-8",
        PGPASSWORD: options.password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (stdout += chunk.toString("utf8")),
    );
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function requireLoopback(url: URL): void {
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new Error(
      "The acceptance runs only on a disposable instance on this machine (127.0.0.1, ::1 or localhost).",
    );
}

function quoteIdentifier(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name))
    throw new Error(
      "The acceptance names databases and roles in lower case only.",
    );
  return `"${name}"`;
}

/**
 * Creates and removes the databases of one acceptance run on a disposable
 * PostgreSQL instance, and activates pgvector as its superuser.
 * @remarks
 * The superuser address comes from a private file and never reaches an
 * argument or a log line. The run creates its own role without superuser
 * rights, as on a Pages installation, with a fresh random password. It only
 * creates and drops databases and roles that carry the run's prefix.
 */
export class TestInstance {
  private readonly adminUrl: URL;
  private readonly roleName: string;
  private readonly rolePassword: string;
  private readonly createdDatabases: string[] = [];
  private isRoleCreated = false;

  private constructor(adminUrl: URL, runId: string) {
    this.adminUrl = adminUrl;
    this.roleName = `${NAME_PREFIX}${runId}`;
    this.rolePassword = randomBytes(24).toString("hex");
  }

  /**
   * Opens the disposable instance named by a private file.
   * @param adminUrlFile - File holding the superuser address of the instance.
   * @param runId - Lower-case identifier of this run.
   * @returns The instance.
   * @throws When the address is no PostgreSQL address on this machine.
   */
  public static async open(
    adminUrlFile: string,
    runId: string,
  ): Promise<TestInstance> {
    const adminUrl = new URL((await readFile(adminUrlFile, "utf8")).trim());
    if (
      adminUrl.protocol !== "postgresql:" &&
      adminUrl.protocol !== "postgres:"
    )
      throw new Error("The admin address file needs a postgresql:// address.");
    requireLoopback(adminUrl);
    const instance = new TestInstance(adminUrl, runId);
    await instance.admin("postgres", async (client) => {
      await client.query(
        `CREATE ROLE ${quoteIdentifier(instance.roleName)} LOGIN PASSWORD '${instance.rolePassword}'`,
      );
    });
    instance.isRoleCreated = true;
    return instance;
  }

  /** Name of the role of `databaseUrl`, owner of every database of the run. */
  public get role(): string {
    return this.roleName;
  }

  /**
   * Creates an empty database with the locale Pages requires, owned by the run's role.
   * @param suffix - Lower-case name part, such as `source`.
   * @returns Its name and private address.
   */
  public async createDatabase(suffix: string): Promise<AcceptanceDatabase> {
    const name = `${this.roleName}_${suffix}`;
    await this.admin("postgres", async (client) => {
      await client.query(
        `CREATE DATABASE ${quoteIdentifier(name)} OWNER ${quoteIdentifier(this.roleName)} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C.UTF-8'`,
      );
    });
    this.createdDatabases.push(name);
    return { name, url: this.databaseUrl(name) };
  }

  /**
   * Applies every Pages migration as the run's role.
   * @param database - A database of the run.
   * @param dataDirectory - Data directory of the instance.
   * @returns The open, migrated database.
   */
  public async migrate(
    database: AcceptanceDatabase,
    dataDirectory: string,
  ): Promise<Database> {
    const opened = await Database.connect(database.url, dataDirectory);
    await opened.migrate(await readMigrations("postgres/migrations"));
    return opened;
  }

  /**
   * Activates or drops pgvector as superuser.
   * @param database - A database of the run.
   * @param isActive - Whether the extension should be installed afterwards.
   */
  public async setVectorExtension(
    database: AcceptanceDatabase,
    isActive: boolean,
  ): Promise<void> {
    await this.admin(database.name, async (client) => {
      await client.query(
        isActive
          ? "CREATE EXTENSION IF NOT EXISTS vector"
          : "DROP EXTENSION IF EXISTS vector",
      );
    });
  }

  /**
   * Writes a logical dump of a database as the run's role.
   * @param database - The database to dump.
   * @param file - Target file in custom format.
   * @throws When `pg_dump` fails.
   */
  public async dump(database: AcceptanceDatabase, file: string): Promise<void> {
    const result = await runProgram("pg_dump", {
      arguments: [
        ...this.connectionArguments(database.name),
        "--format=custom",
        `--file=${file}`,
      ],
      password: this.rolePassword,
    });
    if (result.exitCode !== 0)
      throw new Error(`pg_dump failed: ${result.stderr.trim()}`);
  }

  /**
   * Restores a dump into an empty database as the run's role, without the
   * pgvector entries, as the documented restore does.
   * @param file - Dump in custom format.
   * @param target - Empty database of the run.
   * @param listFile - Where the filtered table of contents is written.
   * @throws When `pg_restore` fails.
   */
  public async restore(
    file: string,
    target: AcceptanceDatabase,
    listFile: string,
  ): Promise<void> {
    const listed = await runProgram("pg_restore", {
      arguments: ["-l", file],
      password: this.rolePassword,
    });
    if (listed.exitCode !== 0)
      throw new Error(`pg_restore -l failed: ${listed.stderr.trim()}`);
    await writeFile(
      listFile,
      listed.stdout
        .split("\n")
        .filter((line) => !EXTENSION_ENTRIES.test(line))
        .join("\n"),
      "utf8",
    );
    const restored = await runProgram("pg_restore", {
      arguments: [
        ...this.connectionArguments(target.name),
        "--no-owner",
        "--exit-on-error",
        `--use-list=${listFile}`,
        file,
      ],
      password: this.rolePassword,
    });
    if (restored.exitCode !== 0)
      throw new Error(`pg_restore failed: ${restored.stderr.trim()}`);
  }

  /** Drops every database and the role this run created. */
  public async close(): Promise<void> {
    await this.admin("postgres", async (client) => {
      for (const name of this.createdDatabases.reverse())
        await client.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`,
        );
      if (this.isRoleCreated)
        await client.query(
          `DROP ROLE IF EXISTS ${quoteIdentifier(this.roleName)}`,
        );
    });
  }

  private databaseUrl(name: string): string {
    const url = new URL(this.adminUrl.href);
    url.username = this.roleName;
    url.password = this.rolePassword;
    url.pathname = `/${name}`;
    return url.href;
  }

  private connectionArguments(name: string): string[] {
    return [
      `--host=${this.adminUrl.hostname.replace(/^\[|\]$/g, "")}`,
      `--port=${this.adminUrl.port || "5432"}`,
      `--username=${this.roleName}`,
      `--dbname=${name}`,
    ];
  }

  private async admin(
    databaseName: string,
    work: (client: Client) => Promise<void>,
  ): Promise<void> {
    const url = new URL(this.adminUrl.href);
    url.pathname = `/${databaseName}`;
    const client = new Client({
      connectionString: url.href,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    try {
      await work(client);
    } finally {
      await client.end();
    }
  }
}
