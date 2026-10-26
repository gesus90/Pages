import { createHash } from "node:crypto";
import { mkdir, open, rename, statfs } from "node:fs/promises";
import { join } from "node:path";

import { readRecord, store } from "./journal.mjs";

/** File payload target, independent of the lifetime output of a job. */
export const OUTPUT_CHUNK_BYTES = 4 * 1024 * 1024;
const FREE_SPACE_RESERVE = 8 * 1024 * 1024;

function filename(sequence) {
  return String(sequence).padStart(12, "0");
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/** Writes all bytes even on filesystems that complete a write only partially. */
export async function writeAll(handle, contents) {
  let offset = 0;
  while (offset < contents.length) {
    const { bytesWritten } = await handle.write(contents.subarray(offset));
    if (bytesWritten <= 0)
      throw new Error("Output journal made no write progress");
    offset += bytesWritten;
  }
}

/** One append-only stream inside the existing job journal; only a committed prefix is readable. */
export class ChunkJournal {
  #directory;
  #binding;
  #identity;
  #aligned;
  #handle = null;
  #chunk = 0;
  #offset = 0;
  #bytes = 0;
  #firstSequence = 0;
  #lastSequence = 0;
  #completedSequence = 0;
  #previous = null;
  #hash = null;
  #dirty = false;
  #isClosed = false;

  constructor(directory, binding, options = {}) {
    this.#directory = directory;
    this.#binding = binding;
    this.#identity = digest(JSON.stringify(binding));
    this.#aligned = options.recordAligned === true;
  }

  /** Creates a new launch's stream; an existing journal is never overwritten or restarted. */
  async initialize() {
    await mkdir(this.#directory, { mode: 0o700 });
    await store(join(this.#directory, "index.json"), {
      version: 2,
      binding: this.#binding,
      identity: this.#identity,
      chunk: 0,
      lastSequence: 0,
      bytes: 0,
      isClosed: false,
    });
  }

  /** Appends with filesystem backpressure; there is no in-memory queue or lifetime byte cap. */
  async append(contents, sequence) {
    if (this.#isClosed) throw new Error("Output journal is closed");
    if (!Number.isSafeInteger(sequence) || sequence < this.#lastSequence)
      throw new Error("Output journal sequence changed");
    if (this.#aligned && contents.length > OUTPUT_CHUNK_BYTES)
      throw new Error("Output journal record exceeds 4 MiB");
    if (this.#aligned && this.#bytes + contents.length > OUTPUT_CHUNK_BYTES)
      await this.#seal();
    let position = 0;
    while (position < contents.length) {
      if (this.#handle === null) await this.#start();
      const count = Math.min(
        contents.length - position,
        OUTPUT_CHUNK_BYTES - this.#bytes,
      );
      const part = contents.subarray(position, position + count);
      await writeAll(this.#handle, part);
      this.#hash.update(part);
      this.#bytes += count;
      this.#firstSequence ||= sequence;
      this.#lastSequence = sequence;
      this.#dirty = true;
      position += count;
      if (this.#bytes === OUTPUT_CHUNK_BYTES) await this.#seal();
    }
    this.#completedSequence = sequence;
    this.#dirty = true;
  }

  /** Publishes an fsynced prefix atomically; a crash tail beyond it remains explicitly uncommitted. */
  async checkpoint(isClosed = false) {
    if (!this.#dirty && !isClosed) return;
    if (this.#handle) {
      await this.#handle.sync();
      await store(
        join(this.#directory, `${filename(this.#chunk)}.json`),
        this.#metadata(false),
      );
    }
    await this.#publish(isClosed);
    this.#dirty = false;
  }

  /** Closes at most one descriptor, preserving committed files on any failure. */
  async close() {
    if (this.#isClosed) return;
    try {
      await this.checkpoint(true);
    } finally {
      await this.#handle?.close();
      this.#handle = null;
      this.#isClosed = true;
    }
  }

  async #start() {
    const space = await statfs(this.#directory);
    if (space.bavail * space.bsize < OUTPUT_CHUNK_BYTES + FREE_SPACE_RESERVE)
      throw Object.assign(
        new Error("Output journal free-space reserve reached"),
        { code: "ENOSPC" },
      );
    this.#chunk += 1;
    this.#bytes = 0;
    this.#firstSequence = 0;
    this.#hash = createHash("sha256");
    this.#handle = await open(
      join(this.#directory, `${filename(this.#chunk)}.part`),
      "wx",
      0o600,
    );
  }

  #metadata(isSealed) {
    return {
      version: 2,
      identity: this.#identity,
      chunk: this.#chunk,
      offset: this.#offset,
      bytes: this.#bytes,
      firstSequence: this.#firstSequence,
      lastSequence: this.#lastSequence,
      sha256: this.#hash.copy().digest("hex"),
      previousSha256: this.#previous,
      isSealed,
    };
  }

  async #seal() {
    if (!this.#handle) return;
    await this.#handle.sync();
    await this.#handle.close();
    this.#handle = null;
    const prefix = join(this.#directory, filename(this.#chunk));
    await rename(`${prefix}.part`, `${prefix}.bin`);
    const metadata = this.#metadata(true);
    await store(`${prefix}.json`, metadata);
    await this.#publish(false);
    this.#offset += this.#bytes;
    this.#previous = metadata.sha256;
    this.#bytes = 0;
    this.#dirty = false;
  }

  async #publish(isClosed) {
    await store(join(this.#directory, "index.json"), {
      version: 2,
      binding: this.#binding,
      identity: this.#identity,
      chunk: this.#chunk,
      lastSequence: this.#completedSequence,
      hasIncompleteRecord: this.#lastSequence > this.#completedSequence,
      bytes: this.#offset + this.#bytes,
      isClosed,
    });
  }
}

/** Rejects a foreign launch or an inaccessible/corrupt index rather than presenting an empty history. */
export async function journalIndex(directory, binding) {
  const index = await readRecord(join(directory, "index.json"));
  if (
    !index ||
    index.version !== 2 ||
    index.identity !== digest(JSON.stringify(binding))
  )
    throw new Error("Output journal identity or index invalid");
  if (
    !Number.isSafeInteger(index.chunk) ||
    index.chunk < 0 ||
    !Number.isSafeInteger(index.lastSequence) ||
    index.lastSequence < 0 ||
    !Number.isSafeInteger(index.bytes) ||
    index.bytes < 0 ||
    typeof index.isClosed !== "boolean"
  )
    throw new Error("Output journal index invalid");
  return index;
}

/** Reads one verified committed chunk, including a recoverable prefix of the final .part file. */
export async function readJournalChunk(directory, index, sequence) {
  const prefix = join(directory, filename(sequence));
  const metadata = await readRecord(`${prefix}.json`);
  if (
    !metadata ||
    metadata.version !== 2 ||
    metadata.identity !== index.identity ||
    metadata.chunk !== sequence ||
    !Number.isSafeInteger(metadata.bytes) ||
    metadata.bytes < 0 ||
    metadata.bytes > OUTPUT_CHUNK_BYTES
  )
    throw new Error("Output journal chunk missing or foreign");
  const previous =
    sequence > 1
      ? await readRecord(join(directory, `${filename(sequence - 1)}.json`))
      : null;
  if (
    metadata.previousSha256 !== (previous?.sha256 ?? null) ||
    metadata.offset !== (previous ? previous.offset + previous.bytes : 0)
  )
    throw new Error("Output journal chunk order invalid");
  let handle;
  try {
    handle = await open(`${prefix}.${metadata.isSealed ? "bin" : "part"}`, "r");
  } catch (error) {
    if (error.code !== "ENOENT" || metadata.isSealed) throw error;
    handle = await open(`${prefix}.bin`, "r");
  }
  try {
    const contents = Buffer.alloc(metadata.bytes);
    let position = 0;
    while (position < contents.length) {
      const { bytesRead } = await handle.read(
        contents,
        position,
        contents.length - position,
        position,
      );
      if (bytesRead === 0) throw new Error("Output journal partial write");
      position += bytesRead;
    }
    if (digest(contents) !== metadata.sha256)
      throw new Error("Output journal integrity failure");
    return {
      contents,
      metadata,
      hasUncommittedTail: (await handle.stat()).size > metadata.bytes,
    };
  } finally {
    await handle.close();
  }
}

/** Seeks the on-disk event chunks by sequence; a transport packet holds at most 16 events / 32 KiB. */
export async function readJournalEvents(directory, binding, after) {
  const index = await journalIndex(directory, binding);
  if (!Number.isSafeInteger(after) || after < 0 || after > index.lastSequence)
    throw new Error("Output journal cursor invalid");
  let first = 1;
  let last = index.chunk;
  while (first < last) {
    const middle = Math.floor((first + last) / 2);
    const metadata = await readRecord(
      join(directory, `${filename(middle)}.json`),
    );
    if (!metadata || metadata.identity !== index.identity)
      throw new Error("Output journal index gap");
    if (metadata.lastSequence <= after) first = middle + 1;
    else last = middle;
  }
  const events = [];
  let bytes = 2;
  for (let chunk = first; chunk <= index.chunk; chunk += 1) {
    const { contents } = await readJournalChunk(directory, index, chunk);
    for (const line of contents.toString("utf8").trimEnd().split("\n")) {
      const event = JSON.parse(line);
      if (event.sequence <= after || event.sequence > index.lastSequence)
        continue;
      if (event.sequence !== after + events.length + 1)
        throw new Error("Output journal event gap");
      const length = Buffer.byteLength(line) + 1;
      if (!events.length && bytes + length > 32768)
        throw new Error("Output journal event exceeds wire budget");
      if (events.length === 16 || bytes + length > 32768)
        return { events, length: index.lastSequence };
      events.push(event);
      bytes += length;
    }
  }
  if (after + events.length !== index.lastSequence)
    throw new Error("Output journal event prefix incomplete");
  return { events, length: index.lastSequence };
}
