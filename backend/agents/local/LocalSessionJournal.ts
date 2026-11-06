import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import {
  localJournalRecordSchema,
  localMutationSchema,
} from "./LocalSessionContracts";
import {
  readLocalRecord,
  requireLocalDirectory,
  writeLocalRecord,
} from "./LocalSessionFiles";

import type { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";
import type {
  LocalJournalRecord,
  LocalSessionMutation,
} from "./LocalSessionContracts";

/** A small index over immutable, synchronized PAGE-223 payload files. */
export class LocalSessionJournal {
  private readonly directory: string;
  private readonly planId: string;
  private readonly files: AgentPayloadFileStore;
  private readonly writes = new SerialQueue();
  private sequence = 0;
  private digest = "";
  private acknowledged = 0;

  public constructor(
    directory: string,
    planId: string,
    files: AgentPayloadFileStore,
  ) {
    this.directory = path.join(directory, "journal");
    this.planId = planId;
    this.files = files;
  }

  /** Recovers the verified tail without reading complete event bodies into memory. */
  public async initialize(): Promise<void> {
    await requireLocalDirectory(this.directory);
    const names = (await readdir(this.directory))
      .filter((name) => /^\d{16}\.json$/u.test(name))
      .sort();
    for (const name of names) {
      const record = localJournalRecordSchema.parse(
        await readLocalRecord(path.join(this.directory, name)),
      );
      if (
        record.sequence !== this.sequence + 1 ||
        record.previousDigest !== this.digest ||
        record.digest !== this.hash(record)
      )
        throw new Error("Local native journal is not contiguous");
      this.sequence = record.sequence;
      this.digest = record.digest;
    }
  }

  /** Fsyncs the body and index before any reader can receive this event. */
  public append(mutation: LocalSessionMutation): Promise<LocalJournalRecord> {
    return this.writes.run(async () => {
      const payload = await this.files.write(
        this.planId,
        JSON.stringify(localMutationSchema.parse(mutation)),
      );
      const base = {
        sequence: this.sequence + 1,
        previousDigest: this.digest,
        payload,
      };
      const record = { ...base, digest: this.hash(base) };
      await writeLocalRecord(this.file(record.sequence), record);
      this.sequence = record.sequence;
      this.digest = record.digest;
      return record;
    });
  }

  /** Reads only a bounded consecutive page after a durable acknowledgement. */
  public async page(
    after: number,
    limit = 100,
  ): Promise<readonly LocalJournalRecord[]> {
    const records: LocalJournalRecord[] = [];
    const end = Math.min(
      this.sequence,
      after + Math.min(200, Math.max(1, limit)),
    );
    for (let sequence = after + 1; sequence <= end; sequence += 1)
      records.push(
        localJournalRecordSchema.parse(
          await readLocalRecord(this.file(sequence)),
        ),
      );
    return records;
  }

  /** Checks both the index digest and the PAGE-223 body checksum. */
  public async body(record: LocalJournalRecord): Promise<LocalSessionMutation> {
    if (record.digest !== this.hash(record))
      throw new Error("Invalid local journal digest");
    return localMutationSchema.parse(
      JSON.parse(await this.files.read(record.payload)),
    );
  }

  /** Accepts only an acknowledgement of an existing immutable record. */
  public async acknowledge(sequence: number, digest: string): Promise<void> {
    if (sequence < 1 || sequence > this.sequence)
      throw new Error("Invalid local journal acknowledgement");
    const record = localJournalRecordSchema.parse(
      await readLocalRecord(this.file(sequence)),
    );
    if (record.digest !== digest)
      throw new Error("Local journal acknowledgement mismatch");
    if (sequence <= this.acknowledged) return;
    await writeLocalRecord(path.join(this.directory, "ack.json"), {
      sequence,
      digest,
    });
    this.acknowledged = sequence;
  }

  private file(sequence: number): string {
    return path.join(
      this.directory,
      `${String(sequence).padStart(16, "0")}.json`,
    );
  }

  private hash(record: {
    readonly sequence: number;
    readonly previousDigest: string;
    readonly payload: string;
  }): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          record.sequence,
          record.previousDigest,
          record.payload,
        ]),
      )
      .digest("hex");
  }
}
