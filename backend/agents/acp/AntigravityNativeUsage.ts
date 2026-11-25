import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { logCaughtError } from "@/backend/logging/Logger";

import { ANTIGRAVITY_APP_DATA_DIRECTORY } from "./AntigravityAcpLaunch";

import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "./AcpSessionContracts";

/** A conversation of `agy acp` is named by its ACP session id. */
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

/** How long a read waits for the CLI's own write lock before it skips one reading. */
const READ_TIMEOUT_MS = 100;

/**
 * How often the calls of a running prompt are read.
 * @remarks
 * `agy acp` writes the row of a model call about 0.1 s after the call's
 * `usage_update`, so a reading at that update always misses the call that
 * just ended; a command the model then waits for can delay the next update
 * by minutes.
 */
const POLL_INTERVAL_MS = 1_000;

/** Protobuf wire types the conversation store uses. */
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;

/**
 * Field numbers in a row of `gen_metadata`, one row per finished model call.
 * @remarks
 * Measured against the prompt usage `agy acp` reports: the sum of input,
 * cache read and output over the rows of a prompt equals the prompt's
 * `inputTokens`, `cachedReadTokens` and `outputTokens`. Absent counts are
 * the protobuf default 0, as the reported cache read 0 of a first call
 * confirms. The cache write count has no verified field and is not read.
 */
const GENERATION_FIELD = 1;
const USAGE_FIELD = 4;
const METADATA_FIELD = 20;
const INPUT_FIELD = 2;
const OUTPUT_FIELD = 3;
const CACHE_READ_FIELD = 5;

interface WireField {
  readonly field: number;
  readonly varint: number | null;
  readonly bytes: Uint8Array | null;
}

/** The counts of one finished model call of an `agy acp` conversation. */
export interface AntigravityCallUsage {
  /** The CLI's own request id of the call; repeated reads of a call share it. */
  readonly callId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

/** The summed counts of the finished model calls of the running prompt. */
export interface AntigravityPromptCalls {
  readonly calls: number;
  /** Input without cache reads, as `agy acp` reports it. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

function readVarint(
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly next: number } | null {
  let value = 0;
  let scale = 1;
  let next = offset;
  for (const byte of bytes.subarray(offset, offset + 10)) {
    value += (byte & 0x7f) * scale;
    scale *= 128;
    next += 1;
    if (byte < 0x80) return { value, next };
  }
  return null;
}

function readValue(
  bytes: Uint8Array,
  offset: number,
  wireType: number,
): { readonly field: Omit<WireField, "field">; readonly next: number } | null {
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
function readFields(bytes: Uint8Array): readonly WireField[] | null {
  const fields: WireField[] = [];
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

function nested(
  fields: readonly WireField[] | null,
  field: number,
): readonly WireField[] | null {
  const bytes = fields?.find((entry) => entry.field === field)?.bytes;
  return bytes ? readFields(bytes) : null;
}

/** A count of the call; an absent field is the protobuf default 0. */
function countOf(fields: readonly WireField[], field: number): number | null {
  const entry = fields.find((candidate) => candidate.field === field);
  if (!entry) return 0;
  return entry.varint !== null && Number.isSafeInteger(entry.varint)
    ? entry.varint
    : null;
}

/** The `request_id` among the key/value entries of a call. */
function requestId(fields: readonly WireField[]): string | null {
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

/**
 * Reads the counts of one row of `gen_metadata`.
 * @param index - The row's stable index in the conversation.
 * @param row - The protobuf the CLI stored for the call.
 * @returns Only the numeric counts and the call's id; `null` for a row without counts.
 */
export function readAntigravityCall(
  index: number,
  row: Uint8Array,
): AntigravityCallUsage | null {
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

/**
 * Sums calls once each, however often a call was read.
 * @param calls - Calls of one prompt in the order they were read.
 * @returns The sum over distinct call ids; a later reading of a call replaces an earlier one.
 */
export function sumAntigravityCalls(
  calls: readonly AntigravityCallUsage[],
): AntigravityPromptCalls {
  const distinct = [
    ...new Map(calls.map((call) => [call.callId, call])).values(),
  ];
  return distinct.reduce<AntigravityPromptCalls>(
    (sum, call) => ({
      calls: sum.calls + 1,
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + call.cacheReadTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
  );
}

function conversationPath(configDirectory: string, sessionId: string): string {
  return path.join(
    configDirectory,
    ANTIGRAVITY_APP_DATA_DIRECTORY,
    "conversations",
    `${sessionId}.db`,
  );
}

/**
 * Reads the model calls of one `agy acp` session after a row index.
 * @param configDirectory - The connection's Gemini folder the session runs with.
 * @param sessionId - The ACP session id, which names its conversation.
 * @param afterIndex - Only rows after this index are read; -1 reads every row.
 * @returns The last row index and the calls after `afterIndex`; nothing without a conversation.
 */
export function readAntigravityCalls(
  configDirectory: string,
  sessionId: string,
  afterIndex: number,
): {
  readonly lastIndex: number;
  readonly calls: readonly AntigravityCallUsage[];
} {
  const file = conversationPath(configDirectory, sessionId);
  if (!SESSION_ID_PATTERN.test(sessionId) || !existsSync(file))
    return { lastIndex: afterIndex, calls: [] };
  const database = new DatabaseSync(file, {
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

/**
 * Follows the finished model calls of each prompt of one `agy acp` session.
 * @remarks
 * `agy acp` reports the token counts of a prompt only in its answer, and its
 * `usage_update` carries only the context occupancy. Its own conversation
 * store, named by the session id, holds one row per finished model call
 * while the prompt runs. The rows that exist before a prompt is sent belong
 * to earlier prompts and attempts; only later rows count, each call once by
 * its request id. While the prompt request is open the rows are read every
 * {@link POLL_INTERVAL_MS} and at each `usage_update`, and each changed sum
 * is reported once. Between prompts nothing is read, so a late reading never
 * counts for the next prompt. A failed read skips that reading only.
 */
export class AntigravityTurnCalls {
  private readonly configDirectory: string;
  private readonly report: (calls: AntigravityPromptCalls) => void;
  private sessionId = "";
  /** The last row read so far, so a prompt start reads only the rows since. */
  private lastIndex = -1;
  private baseline: number | null = null;
  private reported = "";
  private hasLoggedFailure = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(
    configDirectory: string,
    report: (calls: AntigravityPromptCalls) => void,
  ) {
    this.configDirectory = configDirectory;
    this.report = report;
  }

  /**
   * Notes the calls that exist before a prompt is sent and reads the later ones until the prompt answers.
   * @param sessionId - The ACP session the prompt is sent to.
   */
  public begin(sessionId: string): void {
    this.stop();
    if (this.sessionId !== sessionId) this.lastIndex = -1;
    this.sessionId = sessionId;
    this.reported = "";
    this.baseline = this.read(this.lastIndex)?.lastIndex ?? null;
    if (this.baseline === null) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    // A reading never keeps the service alive.
    this.timer.unref();
  }

  /** Reports the calls of the running prompt when their sum changed. */
  public observe(): void {
    if (this.baseline === null) return;
    const calls = this.read(this.baseline)?.calls ?? [];
    if (calls.length === 0) return;
    const sum = sumAntigravityCalls(calls);
    const key = JSON.stringify(sum);
    if (key === this.reported) return;
    this.reported = key;
    this.report(sum);
  }

  /**
   * Keeps reading the calls of the prompt until its request settles.
   * @param answer - The open `session/prompt` request; a closed connection rejects it.
   * @returns The prompt's answer; a failed prompt keeps the calls it finished and reads no more.
   */
  public async follow(
    answer: Promise<PromptResponse>,
  ): Promise<PromptResponse> {
    try {
      return await answer;
    } catch (error: unknown) {
      this.finish();
      throw error;
    } finally {
      this.stop();
    }
  }

  /** Reads the calls of the prompt that ended a last time; later calls belong to the next prompt. */
  public finish(): void {
    this.stop();
    this.observe();
    this.baseline = null;
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One regular reading; outside a notification no handler would catch its failure. */
  private poll(): void {
    try {
      this.observe();
    } catch (error: unknown) {
      logCaughtError("AntigravityTurnCalls", error);
    }
  }

  private read(
    afterIndex: number,
  ): ReturnType<typeof readAntigravityCalls> | null {
    try {
      const read = readAntigravityCalls(
        this.configDirectory,
        this.sessionId,
        afterIndex,
      );
      this.lastIndex = Math.max(this.lastIndex, read.lastIndex);
      return read;
    } catch (error: unknown) {
      if (!this.hasLoggedFailure) logCaughtError("AntigravityTurnCalls", error);
      this.hasLoggedFailure = true;
      return null;
    }
  }
}

/**
 * The call tracker of a plan session of `agy acp`.
 * @param context - The session's context.
 * @returns A tracker reporting to the session's listener; `null` for other adapters and sessions without a conversation store.
 */
export function antigravityTurnCalls(
  context: Pick<
    AcpSessionContext,
    "driver" | "antigravityDataHome" | "listener"
  >,
): AntigravityTurnCalls | null {
  const { driver, antigravityDataHome, listener } = context;
  const report = listener?.antigravityCalls;
  if (driver.provider !== "antigravity" || !antigravityDataHome || !report)
    return null;
  return new AntigravityTurnCalls(antigravityDataHome, report);
}
