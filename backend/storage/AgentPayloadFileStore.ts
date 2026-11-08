import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { AgentDeferredGarbage } from "./AgentDeferredGarbage";

import type { GarbageDatabase } from "./AgentDeferredGarbage";

const PLAN_DIRECTORY = /^agent-payloads\/[a-f0-9]{64}\/$/u;
const FILE_PATH = /^agent-payloads\/[a-f0-9]{64}\/[a-f0-9-]{36}\.payload$/u;
const referenceSchema = z.object({
  version: z.literal(1),
  path: z.string().regex(FILE_PATH),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

/** Internal metadata only; never part of a public run or session contract. */
export type AgentPayloadReference = z.infer<typeof referenceSchema>;

/** Optional only for database clients that never write agent payloads. */
export interface AgentPayloadAccess {
  readonly agentFiles?: AgentPayloadFileStore;
}

/** Requires the instance's explicitly configured data directory for new content. */
export function requireAgentFiles(
  access: AgentPayloadAccess,
): AgentPayloadFileStore {
  if (!access.agentFiles)
    throw new Error("Agent payload storage is not configured.");
  return access.agentFiles;
}

/** Resolves an explicit file column, leaving legacy inline content unchanged. */
export async function readAgentPayload(
  access: AgentPayloadAccess,
  inline: string,
  reference: string | null,
): Promise<string> {
  return reference === null
    ? inline
    : requireAgentFiles(access).read(reference);
}

/** Reads a selected snapshot/recovery packet, whose explicit file column wins over legacy JSON. */
export async function readStoredAgentPayload(
  access: AgentPayloadAccess,
  text: string,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    // Legacy parsers retain their existing damaged-record diagnosis.
    if (error instanceof SyntaxError) return text;
    throw error;
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "path" in parsed &&
    "sha256" in parsed
  )
    return requireAgentFiles(access).read(text);
  return text;
}

/** Immutable, synchronized private files published before their database references. */
export class AgentPayloadFileStore {
  private readonly directory: string;
  private readonly garbage = new SerialQueue();
  private readonly deferred: AgentDeferredGarbage;

  /**
   * Creates the store of one instance data directory.
   *
   * @param directory - The configured data directory.
   * @param options - How long a deferred deletion that left work behind waits before it is tried again.
   */
  public constructor(
    directory: string,
    options: { readonly deferredRetryMs?: number } = {},
  ) {
    this.directory = path.resolve(directory);
    this.deferred = new AgentDeferredGarbage({
      directory: this.directory,
      removePayload: (reference) => this.removeReference(reference),
      retryDelayMs: options.deferredRetryMs,
    });
  }

  /** Writes and fsyncs bytes, then atomically publishes and fsyncs their directory. */
  public async write(planId: string, contents: string): Promise<string> {
    const planKey = createHash("sha256").update(planId).digest("hex");
    const parent = path.join(this.directory, "agent-payloads", planKey);
    await this.prepareDirectory(parent);
    const id = randomUUID();
    const pending = path.join(parent, `.${id}.pending`);
    const storageName = `agent-payloads/${planKey}/${id}.payload`;
    const bytes = Buffer.from(contents, "utf8");
    const file = await open(pending, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(pending, path.join(this.directory, storageName));
    await this.syncDirectory(parent);
    const reference: AgentPayloadReference = {
      version: 1,
      path: storageName,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    return JSON.stringify(reference);
  }

  /** Checks size and SHA-256 on every read; absent and damaged files have distinct safe errors. */
  public async read(serialized: string): Promise<string> {
    try {
      const reference = referenceSchema.parse(JSON.parse(serialized));
      const absolute = path.join(this.directory, reference.path);
      await this.requireDirectory(path.dirname(absolute));
      const file = await open(
        absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stats = await file.stat();
        if (!stats.isFile() || stats.size !== reference.size)
          throw new AgentError("plan_payload_corrupt");
        const bytes = await file.readFile();
        if (
          bytes.length !== reference.size ||
          createHash("sha256").update(bytes).digest("hex") !== reference.sha256
        )
          throw new AgentError("plan_payload_corrupt");
        return bytes.toString("utf8");
      } finally {
        await file.close();
      }
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        throw new AgentError("plan_payload_missing");
      throw new AgentError("plan_payload_corrupt");
    }
  }

  /**
   * Retries committed deletion intents; a failure retains the intent for the next transaction/startup.
   *
   * @remarks
   * Payload files go before this resolves. The purge of earlier plan runs,
   * transcript homes and local session journals take longer and continue in
   * the background, so a commit, such as the start of a new run, never waits
   * for them.
   */
  public async collectGarbage(database: GarbageDatabase): Promise<void> {
    await this.garbage.run(async () => {
      try {
        let hasMore = true;
        while (hasMore) hasMore = await this.removeBatch(database);
      } catch (error: unknown) {
        logCaughtError("AgentPayloadFileStore", error);
      }
    });
    this.deferred.schedule(database);
  }

  /** Resolves once the background deletions that are scheduled now have finished. */
  public async settleGarbage(): Promise<void> {
    await this.deferred.idle();
  }

  /** Stops background deletions; the one in progress finishes first, the rest waits for the next start. */
  public async close(): Promise<void> {
    await this.deferred.close();
  }

  private async removeBatch(database: GarbageDatabase): Promise<boolean> {
    const rows = await database.query(
      `
      SELECT storage_name
      FROM agent_payload_garbage
      WHERE storage_name LIKE 'agent-payloads/%'
      ORDER BY storage_name
      LIMIT 256;
    `,
    );
    for (const row of rows) {
      const storageName = row[0];
      if (typeof storageName !== "string")
        throw new Error("Invalid agent payload deletion.");
      await this.remove(storageName);
      await database.execute(
        "DELETE FROM agent_payload_garbage WHERE storage_name = $storage_name;",
        { storage_name: storageName },
      );
    }
    return rows.length === 256;
  }

  /** Removes the file a payload reference names; anything that is no reference is left alone. */
  private async removeReference(serialized: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    const reference = referenceSchema.safeParse(parsed);
    if (reference.success) await this.remove(reference.data.path);
  }

  private async prepareDirectory(parent: string): Promise<void> {
    const root = path.join(this.directory, "agent-payloads");
    await mkdir(root, { mode: 0o700, recursive: true });
    if (!(await lstat(root)).isDirectory())
      throw new Error("Invalid agent payload directory.");
    await this.syncDirectory(this.directory);
    await mkdir(parent, { mode: 0o700, recursive: true });
    await this.requireDirectory(parent);
    await this.syncDirectory(root);
  }

  private async requireDirectory(parent: string): Promise<void> {
    for (const directory of [
      path.join(this.directory, "agent-payloads"),
      parent,
    ])
      if (!(await lstat(directory)).isDirectory())
        throw new AgentError("plan_payload_corrupt");
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async remove(storageName: string): Promise<void> {
    if (!FILE_PATH.test(storageName) && !PLAN_DIRECTORY.test(storageName))
      throw new Error("Invalid agent payload deletion.");
    const absolute = path.resolve(this.directory, storageName);
    try {
      await this.requireDirectory(
        PLAN_DIRECTORY.test(storageName) ? absolute : path.dirname(absolute),
      );
      await rm(absolute, {
        force: true,
        recursive: PLAN_DIRECTORY.test(storageName),
      });
      const parent = path.dirname(absolute);
      await this.syncDirectory(parent);
    } catch (error: unknown) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
}
