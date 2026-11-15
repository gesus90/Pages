import path from "node:path";

import { vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

interface StorageFile {
  readonly kind: "file" | "directory" | "link";
  readonly modified: number;
  readonly size: number;
}

/** Synthetic storage only; no test touches ~/.pages or executes a package manager. */
export class StorageFiles {
  public readonly entries = new Map<string, StorageFile>();
  public readonly removed: string[] = [];
  public manifestVersion = "1.63.0";
  public lockVersion = "1.63.0";
  public hasManifest = true;

  /** Clears the synthetic instance. */
  public reset(): void {
    this.entries.clear();
    this.removed.length = 0;
    this.manifestVersion = "1.63.0";
    this.lockVersion = "1.63.0";
    this.hasManifest = true;
  }

  /** Seeds a file or directory and its physical parents. */
  public seed(location: string, options: Partial<StorageFile> = {}): void {
    let parent = path.dirname(location);
    while (!this.entries.has(parent)) {
      this.entries.set(parent, { kind: "directory", modified: 0, size: 0 });
      if (parent === "/") break;
      parent = path.dirname(parent);
    }
    this.entries.set(location, {
      kind: "file",
      modified: 0,
      size: 1,
      ...options,
    });
  }

  /** Functions exposed at the filesystem boundary. */
  public module(): Record<string, unknown> {
    return {
      lstat: async (location: string) => {
        const entry = this.require(location);
        return {
          size: entry.size,
          mtimeMs: entry.modified,
          isFile: () => entry.kind === "file",
          isDirectory: () => entry.kind === "directory",
          isSymbolicLink: () => entry.kind === "link",
        };
      },
      readdir: async (location: string) => {
        this.require(location);
        return [...this.entries]
          .filter(
            ([entry]) => entry !== location && path.dirname(entry) === location,
          )
          .map(([entry, metadata]) => ({
            name: path.basename(entry),
            isDirectory: () => metadata.kind === "directory",
            isSymbolicLink: () => metadata.kind === "link",
          }));
      },
      rm: async (location: string) => {
        this.removed.push(location);
        for (const entry of this.entries.keys())
          if (entry === location || entry.startsWith(`${location}/`))
            this.entries.delete(entry);
      },
      rmdir: async (location: string) => {
        this.require(location);
        if (
          [...this.entries.keys()].some((entry) =>
            entry.startsWith(`${location}/`),
          )
        )
          throw Object.assign(new Error("Not empty"), { code: "ENOTEMPTY" });
        this.entries.delete(location);
        this.removed.push(location);
      },
      readFile: async (location: string) => this.read(location),
    };
  }

  private require(location: string): StorageFile {
    const entry = this.entries.get(location);
    if (!entry)
      throw Object.assign(new Error("Missing synthetic file"), {
        code: "ENOENT",
      });
    return entry;
  }

  private read(location: string): string {
    if (location.endsWith("pnpm-lock.yaml"))
      return `importers:\n  .:\n    dependencies:\n      playwright-core:\n        specifier: ${this.lockVersion}\n        version: ${this.lockVersion}\n`;
    if (location.endsWith("playwright-core/package.json"))
      return JSON.stringify({ version: this.manifestVersion });
    if (location.endsWith("browsers.json") && this.hasManifest)
      return JSON.stringify({
        browsers: [
          { name: "chromium", revision: "1243" },
          { name: "chromium-headless-shell", revision: "1243" },
          {
            name: "webkit",
            revision: "2359",
            revisionOverrides: { mac14: "2251" },
          },
        ],
      });
    this.require(location);
    return "";
  }
}

/** Mock writer serialization and committed state across repository/service restarts. */
export class StorageDatabase {
  public readonly runs = new Map<string, number>();
  public readonly writes: { statement: string; parameters?: SqlParameters }[] =
    [];
  public busy: "lease" | "owner" | null = null;
  public isInTransaction = false;
  public failsInbox = false;
  private readonly queue = new SerialQueue();

  public readonly query = vi.fn(
    async (
      statement: string,
      parameters?: SqlParameters,
    ): Promise<readonly DatabaseValue[][]> => {
      if (statement.includes("FROM acp_resource_leases")) {
        expectWorkerQuery(statement);
        return this.busy ? [[this.busy]] : [];
      }
      if (statement.includes("SELECT last_run_ms")) {
        const stamp = this.runs.get(String(parameters?.task));
        return stamp === undefined ? [] : [[stamp]];
      }
      throw new Error(`Unexpected storage query: ${statement}`);
    },
  );

  public readonly execute = vi.fn(
    async (statement: string, parameters?: SqlParameters): Promise<void> => {
      if (
        this.failsInbox &&
        statement.includes("INSERT INTO automation_events")
      )
        throw new Error("Synthetic inbox failure");
      this.writes.push({ statement, parameters });
      if (statement.includes("INSERT INTO pages_storage_maintenance"))
        this.runs.set(String(parameters?.task), Number(parameters?.now));
    },
  );

  /** Mimics the exclusive repository writer and transaction rollback, without PostgreSQL. */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    return this.queue.run(async () => {
      const previous = new Map(this.runs);
      const writeCount = this.writes.length;
      this.isInTransaction = true;
      try {
        return await work({ query: this.query, execute: this.execute });
      } catch (error: unknown) {
        this.runs.clear();
        for (const [task, stamp] of previous) this.runs.set(task, stamp);
        this.writes.length = writeCount;
        throw error;
      } finally {
        this.isInTransaction = false;
      }
    });
  }
}

function expectWorkerQuery(statement: string): void {
  if (
    !statement.includes("agent_local_session_owners WHERE released_at IS NULL")
  )
    throw new Error("Maintenance must protect unreleased local owners too");
}

/** One synthetic filesystem per isolated test file. */
export const storageFiles = new StorageFiles();
