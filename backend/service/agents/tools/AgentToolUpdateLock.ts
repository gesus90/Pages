import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { isAgentToolId } from "@/definition/AgentTools";

import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type {
  AgentToolId,
  AgentToolOperationView,
} from "@/definition/AgentTools";

/** The process that holds a lock: its ID and its start time, so a reused ID never counts. */
interface LockOwner {
  readonly processId: number;
  readonly startedAt: string;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function exists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// Field 22 of /proc/<pid>/stat is the start time in clock ticks since boot.
async function processStart(processId: number): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${processId}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

function isOperation(input: unknown): input is AgentToolOperationView {
  return (
    record(input) &&
    typeof input.action === "string" &&
    (input.state === "running" ||
      input.state === "succeeded" ||
      input.state === "failed") &&
    typeof input.phase === "string" &&
    typeof input.startedAt === "string"
  );
}

/**
 * Keeps one change of a tool combination at a time across every Pages process.
 * @remarks
 * The lock is a file created exclusively below the tools directory. A lock
 * whose process ended, also by a crash, no longer counts and is replaced; a
 * live holder makes a second update fail with `update_running`. Within one
 * process the manager already serializes the work, so a nested acquisition
 * of the same key, such as an adapter installed during its CLI's update,
 * shares the held lock. The last state of each operation is kept next to it,
 * so progress and outcome survive a page reload and a restart.
 */
export class AgentToolUpdateLock {
  private readonly root: string;
  private readonly held = new Map<AgentToolId, number>();
  private readonly writes = new Map<AgentToolId, Promise<void>>();
  private owner: LockOwner | null = null;

  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Takes the lock of a combination, named by its CLI.
   * @returns The release of the lock.
   * @throws {AgentToolReadinessError} `update_running` while another live process holds it.
   */
  public async acquire(key: AgentToolId): Promise<() => Promise<void>> {
    const count = this.held.get(key) ?? 0;
    if (count === 0) await this.create(key);
    this.held.set(key, count + 1);
    let isReleased = false;
    return async () => {
      if (isReleased) return;
      isReleased = true;
      const remaining = (this.held.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.held.set(key, remaining);
        return;
      }
      this.held.delete(key);
      await rm(this.lockFile(key), { force: true });
    };
  }

  /** Whether a live process, this one included, holds the lock of a combination. */
  public async isHeld(key: AgentToolId): Promise<boolean> {
    if (this.held.has(key)) return true;
    const owner = await this.readOwner(key);
    return owner !== null && (await this.isAlive(owner));
  }

  /** Keeps the last state of an operation; writes of one tool stay in order. */
  public saveOperation(
    id: AgentToolId,
    operation: AgentToolOperationView,
  ): void {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.then(() => this.writeOperation(id, operation));
    const settled = next.catch((error: unknown) => {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      console.warn(
        `[pages] Operation state of agent tool ${id} was not kept (${String(code ?? "unknown")}).`,
      );
    });
    this.writes.set(id, settled);
  }

  /** Reads the kept operations; an unreadable entry is left out. */
  public async readOperations(): Promise<
    ReadonlyMap<AgentToolId, AgentToolOperationView>
  > {
    const operations = new Map<AgentToolId, AgentToolOperationView>();
    const directory = path.join(this.root, "operations");
    let names: readonly string[] = [];
    try {
      names = await readdir(directory);
    } catch (error: unknown) {
      if (!missing(error)) throw error;
    }
    for (const name of names) {
      const id = name.replace(/\.json$/u, "");
      if (!name.endsWith(".json") || !isAgentToolId(id)) continue;
      try {
        const input: unknown = JSON.parse(
          await readFile(path.join(directory, name), "utf8"),
        );
        if (isOperation(input)) operations.set(id, input);
      } catch {
        console.warn(
          `[pages] Operation state of agent tool ${id} is unreadable.`,
        );
      }
    }
    return operations;
  }

  private async create(key: AgentToolId): Promise<void> {
    if (await this.tryCreate(key)) return;
    const owner = await this.readOwner(key);
    if (owner !== null && (await this.isAlive(owner)))
      throw new AgentToolReadinessError(key, "updating", "update_running");
    // The holder ended without releasing it, for example by a crash.
    await rm(this.lockFile(key), { force: true });
    if (!(await this.tryCreate(key)))
      throw new AgentToolReadinessError(key, "updating", "update_running");
  }

  // Exclusive creation decides between two processes that try at the same time.
  private async tryCreate(key: AgentToolId): Promise<boolean> {
    const file = this.lockFile(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      await writeFile(file, `${JSON.stringify(await this.self())}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      return true;
    } catch (error: unknown) {
      if (exists(error)) return false;
      throw error;
    }
  }

  private async readOwner(key: AgentToolId): Promise<LockOwner | null> {
    try {
      const input: unknown = JSON.parse(
        await readFile(this.lockFile(key), "utf8"),
      );
      if (
        record(input) &&
        typeof input.processId === "number" &&
        typeof input.startedAt === "string"
      )
        return { processId: input.processId, startedAt: input.startedAt };
      return null;
    } catch (error: unknown) {
      if (missing(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async isAlive(owner: LockOwner): Promise<boolean> {
    return (await processStart(owner.processId)) === owner.startedAt;
  }

  private async self(): Promise<LockOwner> {
    this.owner ??= {
      processId: process.pid,
      startedAt: (await processStart(process.pid)) ?? randomUUID(),
    };
    return this.owner;
  }

  private lockFile(key: AgentToolId): string {
    return path.join(this.root, "locks", `${key}.lock`);
  }

  private async writeOperation(
    id: AgentToolId,
    operation: AgentToolOperationView,
  ): Promise<void> {
    const file = path.join(this.root, "operations", `${id}.json`);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(operation)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
