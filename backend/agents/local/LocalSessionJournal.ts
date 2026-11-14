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
import {
  localJournalDigest,
  readLocalJournalAcknowledgement,
} from "./LocalJournalRecords";

import type { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";
import type {
  LocalJournalRecord,
  LocalSessionMutation,
} from "./LocalSessionContracts";

/** Durable individual mutations with a compact, acknowledged chain anchor. */
export class LocalSessionJournal {
  private readonly directory: string;
  private readonly planId: string;
  private readonly files: AgentPayloadFileStore;
  private readonly writes = new SerialQueue();
  private readonly scheduleCleanup: () => void;
  private sequence = 0;
  private digest = "";
  private acknowledged = 0;
  private acknowledgedDigest = "";

  public constructor(
    directory: string,
    planId: string,
    files: AgentPayloadFileStore,
    scheduleCleanup: () => void = () => undefined,
  ) {
    this.directory = path.join(directory, "journal");
    this.planId = planId;
    this.files = files;
    this.scheduleCleanup = scheduleCleanup;
  }

  /** Recovers the verified tail without reading complete event bodies into memory. */
  public async initialize(): Promise<void> {
    await requireLocalDirectory(this.directory);
    const acknowledgement = await readLocalJournalAcknowledgement(
      this.directory,
    );
    this.acknowledged = acknowledgement.sequence;
    this.acknowledgedDigest = acknowledgement.digest;
    this.sequence = acknowledgement.sequence;
    this.digest = acknowledgement.digest;
    const names = (await readdir(this.directory))
      .filter((name) => /^\d{16}\.json$/u.test(name))
      .sort();
    for (const name of names) {
      if (Number(name.slice(0, 16)) <= this.acknowledged) continue;
      const record = localJournalRecordSchema.parse(
        await readLocalRecord(path.join(this.directory, name)),
      );
      if (
        record.sequence !== this.sequence + 1 ||
        record.previousDigest !== this.digest ||
        record.digest !== localJournalDigest(record)
      )
        throw new Error("Local native journal is not contiguous");
      this.sequence = record.sequence;
      this.digest = record.digest;
    }
    this.scheduleCleanup();
  }

  /** Fsyncs the body and index before any reader can receive this event. */
  public append(mutation: LocalSessionMutation): Promise<LocalJournalRecord> {
    return this.writes.run(async () => {
      const content = JSON.stringify(localMutationSchema.parse(mutation));
      const body =
        Buffer.byteLength(content) <= 4096
          ? { content }
          : { payload: await this.files.write(this.planId, content) };
      const base = {
        sequence: this.sequence + 1,
        previousDigest: this.digest,
        ...body,
      };
      const record = { ...base, digest: localJournalDigest(base) };
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
    const start = Math.max(after, this.acknowledged);
    const end = Math.min(
      this.sequence,
      start + Math.min(200, Math.max(1, limit)),
    );
    for (let sequence = start + 1; sequence <= end; sequence += 1)
      records.push(
        localJournalRecordSchema.parse(
          await readLocalRecord(this.file(sequence)),
        ),
      );
    return records;
  }

  /** Checks both the index digest and the PAGE-223 body checksum. */
  public async body(record: LocalJournalRecord): Promise<LocalSessionMutation> {
    if (record.digest !== localJournalDigest(record))
      throw new Error("Invalid local journal digest");
    return localMutationSchema.parse(
      JSON.parse(
        "content" in record
          ? record.content
          : await this.files.read(record.payload),
      ),
    );
  }

  /** Accepts only an acknowledgement of an existing immutable record. */
  public async acknowledge(sequence: number, digest: string): Promise<void> {
    await this.writes.run(() => this.acknowledgeOnce(sequence, digest));
  }

  private async acknowledgeOnce(sequence: number, digest: string): Promise<void> {
    if (sequence < this.acknowledged) return;
    if (sequence === this.acknowledged) {
      if (digest !== this.acknowledgedDigest)
        throw new Error("Local journal acknowledgement mismatch");
      this.scheduleCleanup();
      return;
    }
    if (sequence < 1 || sequence > this.sequence)
      throw new Error("Invalid local journal acknowledgement");
    const record = localJournalRecordSchema.parse(
      await readLocalRecord(this.file(sequence)),
    );
    if (
      record.digest !== digest ||
      record.digest !== localJournalDigest(record)
    )
      throw new Error("Local journal acknowledgement mismatch");
    await writeLocalRecord(path.join(this.directory, "ack.json"), {
      sequence,
      digest,
    });
    this.acknowledged = sequence;
    this.acknowledgedDigest = digest;
    this.scheduleCleanup();
  }

  private file(sequence: number): string {
    return path.join(
      this.directory,
      `${String(sequence).padStart(16, "0")}.json`,
    );
  }
}
