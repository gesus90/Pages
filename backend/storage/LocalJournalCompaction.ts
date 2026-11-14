import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { setImmediate } from "node:timers/promises";

import { localJournalRecordSchema } from "@/backend/agents/local/LocalSessionContracts";
import {
  readLocalRecord,
  syncLocalDirectory,
} from "@/backend/agents/local/LocalSessionFiles";
import { readLocalJournalAcknowledgement } from "@/backend/agents/local/LocalJournalRecords";
import { AgentPayloadReferenceRepository } from "@/backend/database/repositories/agent/AgentPayloadReferenceRepository";
import { logCaughtError } from "@/backend/logging/Logger";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { LocalJournalRecord } from "@/backend/agents/local/LocalSessionContracts";

const JOURNAL_RECORD = /^\d{16}\.json$/u;
// A record can remove one payload and one journal file: at most 1000 files per batch.
const BATCH_SIZE = 500;

interface StoredRecord {
  readonly file: string;
  readonly record: LocalJournalRecord;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && error.code === "ENOENT"
  );
}

/** Extracts file identity without depending on the serialized metadata's property order. */
export function journalPayloadPath(reference: string): string {
  const parsed: unknown = JSON.parse(reference);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("path" in parsed) ||
    typeof parsed.path !== "string"
  )
    throw new Error("Invalid local journal payload reference");
  return parsed.path;
}

async function directoryNames(directory: string): Promise<string[]> {
  try {
    if (!(await lstat(directory)).isDirectory()) return [];
    return await readdir(directory);
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function readRecord(file: string): Promise<StoredRecord | null> {
  try {
    return {
      file,
      record: localJournalRecordSchema.parse(await readLocalRecord(file)),
    };
  } catch (error: unknown) {
    // The owner and Pages may compact the same acknowledged prefix concurrently.
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Removes only durably acknowledged prefixes, leaving session directories and anchors intact. */
export class LocalJournalCompaction {
  private readonly directory: string;
  private readonly removePayload: (reference: string) => Promise<void>;

  public constructor(
    directory: string,
    removePayload: (reference: string) => Promise<void>,
  ) {
    this.directory = directory;
    this.removePayload = removePayload;
  }

  /** Includes released sessions; a failed session does not prevent cleanup of the others. */
  public async run(database: Pick<DatabaseTransaction, "query">): Promise<void> {
    const root = path.join(this.directory, "local-sessions");
    const references = new AgentPayloadReferenceRepository(database);
    for (const name of await directoryNames(root)) {
      if (!/^[a-f0-9-]{36}$/u.test(name)) continue;
      try {
        const directory = path.join(root, name);
        if (!(await lstat(directory)).isDirectory()) continue;
        await this.compact(path.join(directory, "journal"), references);
      } catch (error: unknown) {
        if (!isMissing(error)) logCaughtError("LocalJournalCompaction", error);
      }
    }
  }

  private async compact(
    directory: string,
    references: AgentPayloadReferenceRepository,
  ): Promise<void> {
    const names = (await directoryNames(directory)).filter((name) =>
      JOURNAL_RECORD.test(name),
    );
    if (names.length === 0) return;
    const anchor = await readLocalJournalAcknowledgement(directory);
    if (anchor.sequence === 0) return;
    // Another process may observe ACK's rename before its writer has synced the directory.
    await syncLocalDirectory(directory);
    const retained = await this.retainedPayloads(directory, names, anchor.sequence);
    let batch: StoredRecord[] = [];
    for (const name of names) {
      if (Number(name.slice(0, 16)) > anchor.sequence) continue;
      const stored = await readRecord(path.join(directory, name));
      if (stored !== null) batch.push(stored);
      if (batch.length < BATCH_SIZE) continue;
      await this.removeBatch(batch, retained, references);
      batch = [];
      await setImmediate();
    }
    await this.removeBatch(batch, retained, references);
  }

  private async retainedPayloads(
    directory: string,
    names: readonly string[],
    sequence: number,
  ): Promise<ReadonlySet<string>> {
    const retained = new Set<string>();
    for (const name of names) {
      if (Number(name.slice(0, 16)) <= sequence) continue;
      const stored = await readRecord(path.join(directory, name));
      if (stored !== null && "payload" in stored.record)
        retained.add(journalPayloadPath(stored.record.payload));
    }
    return retained;
  }

  private async removeBatch(
    batch: readonly StoredRecord[],
    retained: ReadonlySet<string>,
    references: AgentPayloadReferenceRepository,
  ): Promise<void> {
    const paths = batch.flatMap(({ record }) =>
      "payload" in record ? [journalPayloadPath(record.payload)] : [],
    );
    const referenced = await references.referenced(paths);
    for (const { file, record } of batch) {
      if ("payload" in record) {
        const storageName = journalPayloadPath(record.payload);
        if (!retained.has(storageName) && !referenced.has(storageName))
          await this.removePayload(record.payload);
      }
      // Payload deletion is synchronized first. A crash leaves a retryable journal reference.
      await rm(file, { force: true });
    }
  }
}
