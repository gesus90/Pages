// The usage of the model steps a running `opencode acp` prompt finished, read
// from OpenCode's own session database. The row layout mirrors
// backend/agents/cli/OpenCodeSessionUsage.ts, which the Pages host applies to
// a session it runs itself.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A native session is named by the ACP session id OpenCode returned. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const MODEL_PART_PATTERN = /^[^\s\p{Cc}]{1,150}$/u;

/** How long a read waits for OpenCode's own write lock before it skips one reading. */
const READ_TIMEOUT_MS = 100;

/**
 * How often the steps of the running prompt are read. OpenCode writes the
 * counts of a model step when the step ends, and a command the model waits
 * for delays the next step by minutes.
 */
const POLL_INTERVAL_MS = 1000;

/** How often the rows before a prompt are read again when OpenCode holds its write lock. */
const BASELINE_ATTEMPTS = 5;

/** The steps of one job whose usage is kept; later ones are not reported. */
const MAXIMUM_STEPS = 10000;

const SESSION_TREE = `
  WITH RECURSIVE owned(id) AS (
      SELECT id FROM session WHERE id = ?
      UNION ALL
      SELECT child.id FROM session child
      INNER JOIN owned ON child.parent_id = owned.id
  )`;

/**
 * The database the `opencode` process of a job writes its sessions to.
 * OpenCode keeps it below `XDG_DATA_HOME`, or below `.local/share` of the
 * home folder without that variable, so the path follows the environment the
 * runner starts the process with.
 */
export function openCodeDatabasePath(environment) {
  const dataHome =
    environment.XDG_DATA_HOME ||
    join(environment.HOME || homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

function record(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input
    : null;
}

function count(input) {
  return Number.isSafeInteger(input) && input >= 0 ? input : null;
}

function amount(input) {
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    ? input
    : null;
}

/**
 * Whether a row still is the placeholder of a model step that reported
 * nothing: OpenCode writes it when the step starts, with every count and the
 * cost at 0, and replaces them with the measured counts, the finish reason
 * and the total only when the step ends.
 */
function isUnreportedStep(details, tokens, cache) {
  if (typeof details.finish === "string" || tokens?.total !== undefined)
    return false;
  return [
    tokens?.input,
    tokens?.output,
    tokens?.reasoning,
    cache?.read,
    cache?.write,
    details.cost,
  ].every((reading) => reading === 0);
}

function modelOf(details) {
  const { providerID: provider, modelID: model } = details;
  return typeof provider === "string" &&
    typeof model === "string" &&
    MODEL_PART_PATTERN.test(provider) &&
    MODEL_PART_PATTERN.test(model)
    ? `${provider}/${model}`
    : null;
}

/**
 * Reads the usage of one model step from a row of OpenCode's `message` table.
 * Returns `null` for a row that is no assistant message and for a step that
 * has reported nothing yet; a count the row lacks stays `null`, never 0.
 */
export function readOpenCodeStep(row) {
  if (typeof row.id !== "string" || typeof row.session_id !== "string")
    return null;
  if (row.id.length > 200 || row.session_id.length > 200) return null;
  let details;
  try {
    details = record(JSON.parse(String(row.data)));
  } catch {
    return null;
  }
  if (details?.role !== "assistant") return null;
  const tokens = record(details.tokens);
  const cache = record(tokens?.cache);
  if (isUnreportedStep(details, tokens, cache)) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    model: modelOf(details),
    inputTokens: count(tokens?.input),
    outputTokens: count(tokens?.output),
    reasoningTokens: count(tokens?.reasoning),
    cacheReadTokens: count(cache?.read),
    cacheWriteTokens: count(cache?.write),
    costUsd: amount(details.cost),
  };
}

/**
 * Reads the messages of a session and its sub-sessions that were created at
 * or after `since`, in the order OpenCode created them; nothing without a
 * database.
 */
export function readOpenCodeRows(sqlite, file, sessionId, since) {
  if (!SESSION_ID_PATTERN.test(sessionId) || !existsSync(file)) return [];
  const database = new sqlite.DatabaseSync(file, {
    readOnly: true,
    timeout: READ_TIMEOUT_MS,
  });
  try {
    return database
      .prepare(
        `${SESSION_TREE}
          SELECT
              message.id,
              message.session_id,
              message.time_created,
              message.data
          FROM message
          INNER JOIN owned
              ON owned.id = message.session_id
          WHERE message.time_created >= ?
          ORDER BY
              message.time_created,
              message.id;
        `,
      )
      .all(sessionId, since);
  } finally {
    database.close();
  }
}

/** The SQLite reader of this Node.js; `null` on a runtime without one, which then reports no live usage. */
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
 * Follows the finished model steps of the one prompt a runner job sends.
 *
 * `opencode acp` reports the tokens of a prompt only with its answer, and
 * only those of the last model step. Its session database holds one row per
 * model step of the session and of every sub-session, written with the
 * measured counts and the cost when the step ends. The rows that exist before
 * the prompt is sent belong to earlier prompts of a resumed session; only
 * later rows count. While the prompt is open the rows are read every second,
 * and each step is reported once, and again only when its row changed. A
 * failed read skips that reading only. The database is read only while
 * OpenCode runs, which holds it open.
 */
export class OpenCodePromptSteps {
  #file;
  #sessionId;
  #report;
  #sqlite = null;
  #earlier = null;
  #since = 0;
  #reported = new Map();
  #timer = null;

  constructor(file, sessionId, report) {
    this.#file = file;
    this.#sessionId = sessionId;
    this.#report = report;
  }

  /**
   * Notes the rows that exist before the prompt is sent and starts the regular reading.
   * A new session has no earlier rows. A resumed one without a readable
   * database reports no live usage, because its earlier rows cannot be told apart.
   */
  async begin(isResumed) {
    this.#sqlite = await loadSqlite();
    if (!this.#sqlite) return;
    for (let attempt = 0; attempt < BASELINE_ATTEMPTS; attempt += 1) {
      const rows = this.#read(0);
      if (rows) {
        this.#earlier = new Set(rows.map((row) => row.id));
        this.#since = rows.reduce(
          (latest, row) => Math.max(latest, Number(row.time_created) || 0),
          0,
        );
        break;
      }
      await wait(READ_TIMEOUT_MS);
    }
    if (this.#earlier === null && !isResumed) this.#earlier = new Set();
    if (this.#earlier === null) return;
    this.#timer = setInterval(() => this.#observe(), POLL_INTERVAL_MS);
    // A reading never keeps the job process alive.
    this.#timer.unref();
  }

  /** Ends the regular reading and reports the steps a last time. */
  finish() {
    this.#observe();
    this.stop();
  }

  /**
   * Ends the reading without a last one, for an OpenCode that is no longer
   * running: a read-only reading of a database nobody holds open would leave
   * the lock files of its journal behind.
   */
  stop() {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#earlier = null;
  }

  /** Reports every step of the running prompt whose usage is new or changed. */
  #observe() {
    if (this.#earlier === null) return;
    for (const row of this.#read(this.#since) ?? []) {
      if (this.#earlier.has(row.id)) continue;
      const step = readOpenCodeStep(row);
      if (!step) continue;
      const reading = JSON.stringify(step);
      const known = this.#reported.get(step.id);
      if (known === reading) continue;
      if (known === undefined && this.#reported.size >= MAXIMUM_STEPS) continue;
      this.#reported.set(step.id, reading);
      this.#report(step);
    }
  }

  #read(since) {
    try {
      return readOpenCodeRows(this.#sqlite, this.#file, this.#sessionId, since);
    } catch {
      // OpenCode holds its write lock or creates the database; the next reading tries again.
      return null;
    }
  }
}

/**
 * Sends the prompt of a job while the steps it finishes are reported as
 * `pages.usage` events of its output. A failed prompt keeps the steps it
 * finished. An OpenCode that ended no longer holds its database open, so
 * nothing is read after it. A closed output also fails the result that
 * follows, so a lost reading is no error of its own.
 */
export async function followOpenCodeSteps(job, prompt) {
  const { child, sessionId } = job;
  const steps = new OpenCodePromptSteps(
    openCodeDatabasePath(job.environment),
    sessionId,
    (message) =>
      job
        .publish({ type: "pages.usage", sessionId, message })
        .catch(() => null),
  );
  await steps.begin(job.isResumed);
  try {
    return await prompt();
  } finally {
    if (child.exitCode === null && child.signalCode === null) steps.finish();
    else steps.stop();
  }
}
