/**
 * Session readings of a Codex CLI job: the model, the context occupancy and
 * the tokens of the running turn Codex writes to the rollout journal of its
 * thread.
 *
 * `codex exec --json` names neither the occupancy nor the window: its
 * `turn.completed` carries the tokens of every model request of the thread
 * added up, which outgrows the window in a long turn. The rollout
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl` holds, after
 * every model response, an `event_msg` `token_count` whose
 * `info.last_token_usage.total_tokens` is the occupancy and whose
 * `info.model_context_window` is the window, the same pair codex-acp sends as
 * `usage_update`. Its `info.total_token_usage` is the sum `turn.completed`
 * reports at the end, so every model response of a running turn names the
 * tokens used so far. Only these numbers and the model name of
 * `turn_context` leave the file; no rollout text enters the journal.
 */
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const MODEL_NAME = /^[A-Za-z0-9._:@/[\]-]{1,200}$/u;
const THREAD_ID = /^[A-Za-z0-9-]{1,100}$/u;
const DATE_PART = /^\d{2,4}$/u;
const CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
/** A missing rollout, such as the one of an ephemeral job, is looked for at most once a second. */
const SEARCH_INTERVAL_MS = 1000;
const SOURCE = "codex_token_count";
/** The counters Codex adds up over a whole thread, in the rollout and in `turn.completed` alike. */
const THREAD_COUNTERS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

function count(input) {
  return Number.isSafeInteger(input) && input >= 0 ? input : null;
}

function positive(input) {
  const reading = count(input);
  return reading === null || reading === 0 ? null : reading;
}

function modelName(input) {
  return typeof input === "string" && MODEL_NAME.test(input) ? input : null;
}

function validThreadId(threadId) {
  return typeof threadId === "string" && THREAD_ID.test(threadId);
}

/** The thread counters of a `total_token_usage`; `null` when it names none. */
function threadTotals(usage) {
  if (!usage || typeof usage !== "object") return null;
  const totals = Object.fromEntries(
    THREAD_COUNTERS.map((field) => [field, count(usage[field])]),
  );
  return Object.values(totals).every((reading) => reading === null)
    ? null
    : totals;
}

/** Whether a reported counter of `usage` lies below the same counter of a thread sum. */
function isBelow(usage, sum) {
  return THREAD_COUNTERS.some((field) => {
    const total = count(usage[field]);
    return total !== null && total < (sum[field] ?? 0);
  });
}

/**
 * The tokens of the job's own turn among counters Codex adds up per thread.
 * @param session - The reader of the job, which knows what the thread had used before the job.
 * @param usage - `total_token_usage` of the rollout or `usage` of `turn.completed`.
 * @returns The counters without the tokens of earlier turns; `usage` itself
 * for a thread the job began, for a thread whose earlier sum is unknown, and
 * for counters that do not count the thread.
 * @remarks
 * A resumed thread keeps counting where its last turn ended, so its sum at
 * the start of the job is subtracted from every later sum. A sum never
 * falls, so counters below the latest sum of the rollout are the turn's own
 * and stay as reported. A counter Codex did not report stays unreported and
 * never becomes 0.
 */
export function codexTurnUsage(session, usage) {
  const baseline = session?.baseline;
  if (!baseline || !usage || typeof usage !== "object") return usage;
  if (isBelow(usage, session.totals ?? baseline)) return usage;
  const own = { ...usage };
  for (const field of THREAD_COUNTERS) {
    const total = count(usage[field]);
    if (total !== null) own[field] = total - (baseline[field] ?? 0);
  }
  return own;
}

/** The date folders of `directory`, newest first, so the rollout of a running thread is found early. */
async function datedFolders(directory) {
  // Codex creates the folders with the first rollout; until then there is nothing to find.
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isDirectory() && DATE_PART.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .map((name) => join(directory, name));
}

async function findInDay(directory, threadId) {
  const entries = await readdir(directory, { withFileTypes: true });
  const file = entries.find(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith("rollout-") &&
      entry.name.endsWith(`-${threadId}.jsonl`),
  );
  return file ? join(directory, file.name) : null;
}

/** The rollout of a thread in the year, month and day folders of `sessions`; `null` when there is none. */
async function findRollout(sessions, threadId) {
  for (const year of await datedFolders(sessions))
    for (const month of await datedFolders(year))
      for (const day of await datedFolders(month)) {
        const file = await findInDay(day, threadId);
        if (file) return file;
      }
  return null;
}

/**
 * Applies one rollout record.
 * @returns Whether it changed the model, the occupancy, the window or the thread's token sum.
 * @remarks
 * `task_started` names the window of the turn before its `turn_context`
 * names the model, so the window waits for the model it belongs to. Another
 * model ends every value measured for the previous one. A `token_count`
 * without `info` names no usage and keeps the last value.
 */
function applyRecord(record, session) {
  const payload = record?.payload;
  if (record?.type === "event_msg" && payload?.type === "task_started") {
    session.window = positive(payload.model_context_window);
    return false;
  }
  if (record?.type === "turn_context") {
    const model = modelName(payload?.model);
    if (model === null) return false;
    if (model !== session.model) {
      session.model = model;
      session.used = null;
      session.limit = null;
    }
    session.limit = session.window ?? session.limit;
    session.window = null;
    return true;
  }
  if (record?.type !== "event_msg" || payload?.type !== "token_count")
    return false;
  const info = payload.info;
  if (!info || typeof info !== "object") return false;
  session.used = count(info.last_token_usage?.total_tokens) ?? session.used;
  session.limit = positive(info.model_context_window) ?? session.limit;
  applyThreadTotals(threadTotals(info.total_token_usage), session);
  return true;
}

/**
 * Keeps the thread's latest token sum. A sum below the one before the job
 * started over, so nothing is subtracted from it any more.
 */
function applyThreadTotals(totals, session) {
  if (totals === null) return;
  if (session.baseline !== null && isBelow(totals, session.baseline))
    session.baseline = null;
  session.totals = totals;
}

function applyLine(line, session) {
  // Only three record kinds matter; every other line, such as a long tool output, stays unparsed.
  if (
    !line.includes('"token_count"') &&
    !line.includes('"turn_context"') &&
    !line.includes('"task_started"')
  )
    return false;
  try {
    return applyRecord(JSON.parse(line), session);
  } catch {
    // A line Codex has not finished writing is read again after its newline.
    return false;
  }
}

/**
 * Applies complete lines and yields each reading before the next record changes it.
 * @returns Pairs of the kind of a reading, `context` or `tokens`, and its text.
 */
function* applyText(text, session) {
  const lines = (session.pending + text).split("\n");
  session.pending = lines.pop() ?? "";
  for (const line of lines) {
    const isComplete = !session.isSkipping && line.length <= MAX_LINE_BYTES;
    session.isSkipping = false;
    if (!isComplete || !applyLine(line, session) || !session.isConfirmed)
      continue;
    if (session.model !== null)
      yield ["context", JSON.stringify(reading(session))];
    const tokens = turnTokens(session);
    if (tokens !== null) yield ["tokens", JSON.stringify(tokens)];
  }
  if (session.pending.length > MAX_LINE_BYTES) {
    session.pending = "";
    session.isSkipping = true;
  }
}

async function* readNewRecords(session) {
  const handle = await open(
    session.file,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const bytes = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      const chunk = await handle.read(bytes, 0, bytes.length, session.offset);
      if (chunk.bytesRead === 0) return;
      session.offset += chunk.bytesRead;
      const text = session.decoder.write(bytes.subarray(0, chunk.bytesRead));
      yield* applyText(text, session);
    }
  } finally {
    await handle.close();
  }
}

async function locate(session) {
  if (session.file !== null) return true;
  const now = Date.now();
  if (now - session.searchedAt < SEARCH_INTERVAL_MS) return false;
  session.searchedAt = now;
  session.file = await findRollout(
    join(session.home, "sessions"),
    session.threadId,
  );
  return session.file !== null;
}

function reading(session) {
  return {
    session: {
      model: session.model,
      context:
        session.used === null && session.limit === null
          ? null
          : { used: session.used, limit: session.limit, source: SOURCE },
    },
  };
}

/**
 * The tokens the running turn used so far, as a `usage` event names them.
 * @returns `null` before the turn measured anything, after its end, and for
 * a resumed thread whose earlier sum is unknown.
 * @remarks
 * `isInterim` marks the reading of a turn that still runs: the counters of
 * `turn.completed` replace it under the same attempt and turn. The input
 * contains the cache reads, as Codex counts it.
 */
function turnTokens(session) {
  if (session.isTurnEnded || !session.isThreadKnown || session.totals === null)
    return null;
  const own = codexTurnUsage(session, session.totals);
  const tokens = {
    inputTokens: count(own.input_tokens),
    outputTokens: count(own.output_tokens),
    cacheReadTokens: count(own.cached_input_tokens),
    cacheWriteTokens: count(own.cache_write_input_tokens),
    totalTokens: count(own.total_tokens),
  };
  const hasMeasured = Object.values(tokens).some((reading) => reading > 0);
  return hasMeasured ? { ...tokens, isInterim: true } : null;
}

async function* scan(session) {
  if (session.threadId === null || session.isDisabled) return;
  try {
    if (await locate(session)) yield* readNewRecords(session);
  } catch {
    // A rollout that cannot be read leaves the context unreported; the job itself goes on.
    session.isDisabled = true;
  }
}

/**
 * Creates the reader of one job; nothing is shared between jobs or runs.
 * @param home - The `CODEX_HOME` of the job; `null` reads nothing.
 * @param resumeThreadId - The recorded thread to resume, when the job has one.
 * @remarks
 * `totals` is the thread's latest token sum and `baseline` its sum before the
 * job. `isThreadKnown` says whether that earlier sum is known: a thread the
 * job begins has none, a resumed one has the sum of its rollout.
 */
export function createCodexSessionReader(home, resumeThreadId) {
  const threadId = validThreadId(resumeThreadId) ? resumeThreadId : null;
  return {
    home,
    isConfirmed: false,
    isDisabled: typeof home !== "string" || !home.startsWith("/"),
    threadId,
    file: null,
    offset: 0,
    pending: "",
    isSkipping: false,
    decoder: new StringDecoder("utf8"),
    searchedAt: 0,
    model: null,
    window: null,
    used: null,
    limit: null,
    totals: null,
    baseline: null,
    isThreadKnown: threadId === null,
    isTurnEnded: false,
    sent: { context: null, tokens: null },
  };
}

/**
 * Skips the resumed thread's existing records before the child can append a new turn.
 * @remarks
 * The token sum those records end with is what the thread had used before
 * the job; a rollout that was not found leaves it unknown.
 */
export async function prepareCodexSession(session) {
  if (session.isConfirmed) return;
  await scan(session).next();
  session.baseline = session.totals;
  session.isThreadKnown ||= session.file !== null;
  session.totals = null;
  session.model = null;
  session.window = null;
  session.used = null;
  session.limit = null;
  if (session.pending !== "") {
    session.pending = "";
    session.isSkipping = true;
  }
}

/**
 * Confirms the job's thread and reads its rollout with every Codex event.
 * @remarks
 * The thread is the one `thread.started` names. An ephemeral job writes no
 * rollout, so its context and the tokens of its running turn stay
 * unreported, as does every value Codex did not write; no value is derived
 * from the summed tokens of `turn.completed`. The end of the turn ends its
 * interim token readings, so none follows the counters of `turn.completed`.
 */
export async function receiveCodexSession(event, session, emit) {
  if (["turn.completed", "turn.failed"].includes(event?.type))
    session.isTurnEnded = true;
  if (
    event?.type === "thread.started" &&
    !session.isConfirmed &&
    validThreadId(event.thread_id)
  ) {
    if (session.threadId !== null && session.threadId !== event.thread_id) {
      // Another thread has its own sum, so the one read before the job does not apply.
      session.isDisabled = true;
      session.baseline = null;
      return;
    }
    session.threadId = event.thread_id;
    session.isConfirmed = true;
    session.searchedAt = 0;
  }
  await pollCodexSession(session, emit);
}

/** Reports changes from the confirmed rollout even while the child emits no stdout. */
export async function pollCodexSession(session, emit) {
  if (!session.isConfirmed) return;
  for await (const [kind, text] of scan(session)) {
    if (text === session.sent[kind]) continue;
    await emit({
      kind: "usage",
      text,
      createdAt: new Date().toISOString(),
      isTruncated: false,
      channel: "stdout",
    });
    session.sent[kind] = text;
  }
}

/** Reads what Codex wrote before it exited, such as the reading of the final answer. */
export async function finishCodexSession(session, emit) {
  session.searchedAt = 0;
  await pollCodexSession(session, emit);
}
