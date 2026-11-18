/**
 * Session readings of a Codex CLI job: the model and the context occupancy
 * Codex writes to the rollout journal of its thread.
 *
 * `codex exec --json` names neither the occupancy nor the window: its
 * `turn.completed` carries the tokens of every model request of the turn
 * added up, which outgrows the window in a long turn. The rollout
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl` holds, after
 * every model response, an `event_msg` `token_count` whose
 * `info.last_token_usage.total_tokens` is the occupancy and whose
 * `info.model_context_window` is the window, the same pair codex-acp sends as
 * `usage_update`. Only these numbers and the model name of `turn_context`
 * leave the file; no rollout text enters the journal.
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
 * @returns Whether it changed the model, the occupancy or the window.
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
  session.used = positive(info.last_token_usage?.total_tokens) ?? session.used;
  session.limit = positive(info.model_context_window) ?? session.limit;
  return true;
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

/** Applies the complete lines of a chunk; a line beyond 8 MiB is dropped up to its newline. */
function applyText(text, session) {
  const lines = (session.pending + text).split("\n");
  session.pending = lines.pop() ?? "";
  let hasChanged = false;
  for (const line of lines) {
    if (!session.isSkipping && applyLine(line, session)) hasChanged = true;
    session.isSkipping = false;
  }
  if (session.pending.length > MAX_LINE_BYTES) {
    session.pending = "";
    session.isSkipping = true;
  }
  return hasChanged;
}

async function readNewRecords(session) {
  const handle = await open(
    session.file,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const bytes = Buffer.alloc(CHUNK_BYTES);
    let hasChanged = false;
    for (;;) {
      const chunk = await handle.read(bytes, 0, bytes.length, session.offset);
      if (chunk.bytesRead === 0) return hasChanged;
      session.offset += chunk.bytesRead;
      const text = session.decoder.write(bytes.subarray(0, chunk.bytesRead));
      if (applyText(text, session)) hasChanged = true;
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

async function scan(session, emit) {
  if (!(await locate(session))) return;
  const hasChanged = await readNewRecords(session);
  // A resumed thread's history only sets the state; what it held is reported with the first record of the new turn.
  if (session.isBaseline) {
    session.isBaseline = false;
    return;
  }
  if (!hasChanged || session.model === null) return;
  const text = JSON.stringify(reading(session));
  if (text === session.last) return;
  session.last = text;
  await emit({
    kind: "usage",
    text,
    createdAt: new Date().toISOString(),
    isTruncated: false,
    channel: "stdout",
  });
}

async function scanSafely(session, emit) {
  if (session.threadId === null || session.isDisabled) return;
  try {
    await scan(session, emit);
  } catch {
    // A rollout that cannot be read leaves the context unreported; the job itself goes on.
    session.isDisabled = true;
  }
}

/**
 * Creates the reader of one job; nothing is shared between jobs or runs.
 * @param home - The `CODEX_HOME` of the job; `null` reads nothing.
 * @param isResume - Whether the job resumes a recorded thread, whose rollout already holds history.
 */
export function createCodexSessionReader(home, isResume) {
  return {
    home,
    isBaseline: Boolean(isResume),
    isDisabled: typeof home !== "string" || !home.startsWith("/"),
    threadId: null,
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
    last: null,
  };
}

/**
 * Follows the rollout of the job's thread with every Codex event and emits a
 * session reading when the model, the occupancy or the window changed.
 * @remarks
 * The thread is the one `thread.started` names. An ephemeral job writes no
 * rollout, so its context stays unreported, as does every value Codex did not
 * write; no value is derived from the summed tokens of `turn.completed`.
 */
export async function receiveCodexSession(event, session, emit) {
  if (
    event?.type === "thread.started" &&
    session.threadId === null &&
    typeof event.thread_id === "string" &&
    THREAD_ID.test(event.thread_id)
  )
    session.threadId = event.thread_id;
  await scanSafely(session, emit);
}

/** Reads what Codex wrote before it exited, such as the reading of the final answer. */
export async function finishCodexSession(session, emit) {
  session.searchedAt = 0;
  await scanSafely(session, emit);
}
