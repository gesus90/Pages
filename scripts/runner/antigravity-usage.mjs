// The token counts of a running `agy acp` prompt, read from the CLI's own
// conversation store. The row layout mirrors
// backend/agents/acp/AntigravityNativeUsage.ts, which the Pages host applies
// to a session it runs itself.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ANTIGRAVITY_APP_DATA_DIRECTORY } from "./antigravity-context.mjs";

/** A conversation of `agy acp` is named by its ACP session id. */
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/iu;

/** How long a read waits for the CLI's own write lock before it skips one reading. */
const READ_TIMEOUT_MS = 100;

/**
 * How often the calls of the running prompt are read. `agy acp` writes the
 * row of a model call just after the call's `usage_update`, and a command the
 * model waits for delays the next update by minutes.
 */
const POLL_INTERVAL_MS = 1000;

/** How often the rows before a prompt are read again when the CLI holds its write lock. */
const BASELINE_ATTEMPTS = 5;

/** Protobuf wire types the conversation store uses. */
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;

// Field numbers in a row of `gen_metadata`, one row per finished model call:
// message 1 holds message 4 with input without cache reads (2), output (3)
// and cache reads (5), and the key/value entries (20) with `request_id`. An
// absent count is the protobuf default 0. The cache write count has no
// verified field and is not read.
const GENERATION_FIELD = 1;
const USAGE_FIELD = 4;
const METADATA_FIELD = 20;
const INPUT_FIELD = 2;
const OUTPUT_FIELD = 3;
const CACHE_READ_FIELD = 5;

function readVarint(bytes, offset) {
  let value = 0;
  let scale = 1;
  for (let index = offset; index < bytes.length && index < offset + 10;) {
    const byte = bytes[index];
    value += (byte & 0x7f) * scale;
    scale *= 128;
    index += 1;
    if (byte < 0x80) return { value, next: index };
  }
  return null;
}

function readValue(bytes, offset, wireType) {
  if (wireType === WIRE_VARINT) {
    const varint = readVarint(bytes, offset);
    return varint
      ? { field: { varint: varint.value, bytes: null }, next: varint.next }
      : null;
  }
  if (wireType === WIRE_FIXED64 || wireType === WIRE_FIXED32) {
    const next = offset + (wireType === WIRE_FIXED64 ? 8 : 4);
    return next <= bytes.length
      ? { field: { varint: null, bytes: null }, next }
      : null;
  }
  if (wireType !== WIRE_BYTES) return null;
  const length = readVarint(bytes, offset);
  if (!length || length.next + length.value > bytes.length) return null;
  const next = length.next + length.value;
  return {
    field: { varint: null, bytes: bytes.subarray(length.next, next) },
    next,
  };
}

/** The top-level fields of one protobuf message, or `null` when it is malformed. */
function readFields(bytes) {
  const fields = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key || key.value < 8) return null;
    const parsed = readValue(bytes, key.next, key.value % 8);
    if (!parsed) return null;
    fields.push({ field: Math.floor(key.value / 8), ...parsed.field });
    offset = parsed.next;
  }
  return fields;
}

function nested(fields, field) {
  const bytes = fields?.find((entry) => entry.field === field)?.bytes;
  return bytes ? readFields(bytes) : null;
}

/** A count of the call; an absent field is the protobuf default 0. */
function countOf(fields, field) {
  const entry = fields.find((candidate) => candidate.field === field);
  if (!entry) return 0;
  return entry.varint !== null && Number.isSafeInteger(entry.varint)
    ? entry.varint
    : null;
}

/** The `request_id` among the key/value entries of a call. */
function requestId(fields) {
  const decoder = new TextDecoder();
  for (const entry of fields) {
    if (entry.field !== METADATA_FIELD || !entry.bytes) continue;
    const pair = readFields(entry.bytes);
    const key = pair?.find((part) => part.field === 1)?.bytes;
    const value = pair?.find((part) => part.field === 2)?.bytes;
    if (key && value && decoder.decode(key) === "request_id")
      return decoder.decode(value);
  }
  return null;
}

/** Reads only the numeric counts and the call's id of one row; `null` for a row without counts. */
export function readAntigravityCall(index, row) {
  const generation = nested(readFields(row), GENERATION_FIELD);
  const usage = nested(generation, USAGE_FIELD);
  if (!generation || !usage) return null;
  const inputTokens = countOf(usage, INPUT_FIELD);
  const outputTokens = countOf(usage, OUTPUT_FIELD);
  const cacheReadTokens = countOf(usage, CACHE_READ_FIELD);
  if (inputTokens === null || outputTokens === null || cacheReadTokens === null)
    return null;
  return {
    callId: requestId(generation) ?? `index:${index}`,
    inputTokens,
    outputTokens,
    cacheReadTokens,
  };
}

/** Sums calls once each by their id, however often a call was read. */
export function sumAntigravityCalls(calls) {
  const distinct = [
    ...new Map(calls.map((call) => [call.callId, call])).values(),
  ];
  return distinct.reduce(
    (sum, call) => ({
      calls: sum.calls + 1,
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + call.cacheReadTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  );
}

/**
 * Reads the model calls of one `agy acp` session after a row index.
 * Returns the last row index and the calls after `afterIndex`; nothing without a conversation.
 */
export function readAntigravityCalls(
  sqlite,
  geminiHome,
  sessionId,
  afterIndex,
) {
  const file = join(
    geminiHome,
    ANTIGRAVITY_APP_DATA_DIRECTORY,
    "conversations",
    `${sessionId}.db`,
  );
  if (!SESSION_ID_PATTERN.test(sessionId) || !existsSync(file))
    return { lastIndex: afterIndex, calls: [] };
  const database = new sqlite.DatabaseSync(file, {
    readOnly: true,
    timeout: READ_TIMEOUT_MS,
  });
  try {
    const rows = database
      .prepare(
        `
          SELECT
              idx,
              data
          FROM gen_metadata
          WHERE idx > ?
          ORDER BY idx;
        `,
      )
      .all(afterIndex);
    let lastIndex = afterIndex;
    const calls = rows.flatMap((row) => {
      if (typeof row.idx !== "number" || !(row.data instanceof Uint8Array))
        return [];
      lastIndex = Math.max(lastIndex, row.idx);
      const call = readAntigravityCall(row.idx, row.data);
      return call ? [call] : [];
    });
    return { lastIndex, calls };
  } finally {
    database.close();
  }
}

/** The SQLite reader of this Node.js; `null` on a runtime without one, which then reports no live count. */
async function loadSqlite() {
  try {
    return await import("node:sqlite");
  } catch {
    return null;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Follows the finished model calls of the one prompt a runner job sends.
 *
 * `agy acp` reports the token counts of a prompt only in its answer. Its
 * conversation store, named by the session id, holds one row per finished
 * model call while the prompt runs. The rows that exist before the prompt is
 * sent belong to earlier prompts of a resumed session; only later rows count,
 * each call once by its request id. While the prompt is open the rows are
 * read every second, and each changed sum is reported once. A failed read
 * skips that reading only. The store is read only while the CLI runs, which
 * holds it open.
 */
export class AntigravityPromptCalls {
  #geminiHome;
  #sessionId;
  #report;
  #sqlite = null;
  #baseline = null;
  #reported = "";
  #timer = null;

  constructor(geminiHome, sessionId, report) {
    this.#geminiHome = geminiHome;
    this.#sessionId = sessionId;
    this.#report = report;
  }

  /**
   * Notes the rows that exist before the prompt is sent and starts the regular reading.
   * A new conversation has no earlier rows. A resumed one without a readable
   * store reports no live count, because its earlier rows cannot be told apart.
   */
  async begin(isResumed) {
    this.#sqlite = await loadSqlite();
    if (!this.#sqlite) return;
    for (let attempt = 0; attempt < BASELINE_ATTEMPTS; attempt += 1) {
      const read = this.#read(-1);
      if (read) {
        this.#baseline = read.lastIndex;
        break;
      }
      await wait(READ_TIMEOUT_MS);
    }
    if (this.#baseline === null && !isResumed) this.#baseline = -1;
    if (this.#baseline === null) return;
    this.#timer = setInterval(() => this.#observe(), POLL_INTERVAL_MS);
    // A reading never keeps the job process alive.
    this.#timer.unref();
  }

  /** Ends the regular reading and reports the calls a last time; the prompt's own answer replaces them. */
  finish() {
    this.#observe();
    this.stop();
  }

  /**
   * Ends the reading without a last one, for a CLI that is no longer running.
   * A read-only reading of a store nobody holds open would leave the lock
   * files of its journal behind.
   */
  stop() {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#baseline = null;
  }

  /** Reports the calls of the running prompt when their sum changed. */
  #observe() {
    if (this.#baseline === null) return;
    const calls = this.#read(this.#baseline)?.calls ?? [];
    if (calls.length === 0) return;
    const sum = sumAntigravityCalls(calls);
    const key = JSON.stringify(sum);
    if (key === this.#reported) return;
    this.#reported = key;
    this.#report(sum);
  }

  #read(afterIndex) {
    try {
      return readAntigravityCalls(
        this.#sqlite,
        this.#geminiHome,
        this.#sessionId,
        afterIndex,
      );
    } catch {
      // The CLI holds its write lock or creates the store; the next reading tries again.
      return null;
    }
  }
}
