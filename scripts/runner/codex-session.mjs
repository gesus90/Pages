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

function validThreadId(threadId) {
  return typeof threadId === "string" && THREAD_ID.test(threadId);
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
  session.used = count(info.last_token_usage?.total_tokens) ?? session.used;
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

/** Applies complete lines and yields each reading before the next record changes it. */
function* applyText(text, session) {
  const lines = (session.pending + text).split("\n");
  session.pending = lines.pop() ?? "";
  for (const line of lines) {
    const isComplete = !session.isSkipping && line.length <= MAX_LINE_BYTES;
    session.isSkipping = false;
    if (!isComplete || !applyLine(line, session) || !session.isConfirmed)
      continue;
    if (session.model !== null) yield JSON.stringify(reading(session));
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
 */
export function createCodexSessionReader(home, resumeThreadId) {
  return {
    home,
    isConfirmed: false,
    isDisabled: typeof home !== "string" || !home.startsWith("/"),
    threadId: validThreadId(resumeThreadId) ? resumeThreadId : null,
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

/** Skips the resumed thread's existing records before the child can append a new turn. */
export async function prepareCodexSession(session) {
  if (session.isConfirmed) return;
  await scan(session).next();
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
 * rollout, so its context stays unreported, as does every value Codex did not
 * write; no value is derived from the summed tokens of `turn.completed`.
 */
export async function receiveCodexSession(event, session, emit) {
  if (
    event?.type === "thread.started" &&
    !session.isConfirmed &&
    validThreadId(event.thread_id)
  ) {
    if (session.threadId !== null && session.threadId !== event.thread_id) {
      session.isDisabled = true;
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
  for await (const text of scan(session)) {
    if (text === session.last) continue;
    await emit({
      kind: "usage",
      text,
      createdAt: new Date().toISOString(),
      isTruncated: false,
      channel: "stdout",
    });
    session.last = text;
  }
}

/** Reads what Codex wrote before it exited, such as the reading of the final answer. */
export async function finishCodexSession(session, emit) {
  session.searchedAt = 0;
  await pollCodexSession(session, emit);
}
