/**
 * Session readings of a Claude Code CLI job: the model the CLI reported and
 * the context occupancy of the latest top-level answer, kept apart from the
 * token accounting in `usage.mjs`.
 */

/** Claude's own banners, such as a spend limit, carry no real usage. */
export const SYNTHETIC_MODEL = "<synthetic>";
const MODEL_NAME = /^[A-Za-z0-9._:@/[\]-]{1,200}$/u;
const WINDOW_REQUEST_ID = "pages-context-window";
/** The CLI names this source when it assumed a default window for a model it does not know. */
const ASSUMED_WINDOW_SOURCE = "unknown-model";
/** A selection suffix such as `[1m]`, which the CLI's answers may leave out. */
const SELECTION_SUFFIX = /\[[^\]]{1,20}\]$/u;

/**
 * The control request that asks the CLI for the context window of its model.
 * The `summary` detail is answered by the CLI itself: no user message is sent
 * and no model is called.
 */
export const CLAUDE_WINDOW_REQUEST = `${JSON.stringify({
  type: "control_request",
  request_id: WINDOW_REQUEST_ID,
  request: { subtype: "get_context_usage", detail: "summary" },
})}\n`;

function count(input) {
  return Number.isSafeInteger(input) && input >= 0 ? input : null;
}

/** The model an event names, or `null` for a banner and for a name outside the allowed characters. */
export function claudeModelName(input) {
  return typeof input === "string" &&
    input !== SYNTHETIC_MODEL &&
    MODEL_NAME.test(input)
    ? input
    : null;
}

/** The tokens one answer holds in context; `null` as soon as one counter is missing. */
function occupancy(usage) {
  const readings = [
    usage?.input_tokens,
    usage?.output_tokens,
    usage?.cache_read_input_tokens,
    usage?.cache_creation_input_tokens,
  ].map(count);
  if (readings.some((reading) => reading === null)) return null;
  return count(readings.reduce((total, reading) => total + reading, 0));
}

/**
 * The context window of the model that produced the answers.
 * Only the entry of exactly that model counts, or the one entry whose name
 * extends it (such as `claude-sonnet-5-5[1m]`); a subagent model never does.
 */
function contextWindow(modelUsage, model) {
  if (!model || !modelUsage || typeof modelUsage !== "object") return null;
  const exact = modelUsage[model];
  if (exact) return positive(exact.contextWindow);
  const matches = Object.entries(modelUsage).filter(
    ([name]) => name.startsWith(model) || model.startsWith(name),
  );
  return matches.length === 1 ? positive(matches[0][1]?.contextWindow) : null;
}

function positive(input) {
  const reading = count(input);
  return reading === null || reading === 0 ? null : reading;
}

function parsedLines(stdout) {
  return stdout.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/**
 * Reads the CLI's answer to {@link CLAUDE_WINDOW_REQUEST}.
 * @returns The model the job's selection resolves to and `rawMaxTokens`, the
 * window the CLI uses for it; `null` without a valid answer or when the CLI
 * only assumed a window for a model it does not know.
 */
export function readClaudeWindow(stdout) {
  if (typeof stdout !== "string") return null;
  const answer = parsedLines(stdout).find(
    (message) =>
      message?.type === "control_response" &&
      message.response?.request_id === WINDOW_REQUEST_ID,
  )?.response;
  if (answer?.subtype !== "success") return null;
  const model = claudeModelName(answer.response?.model);
  const limit = positive(answer.response?.rawMaxTokens);
  if (
    model === null ||
    limit === null ||
    answer.response.autocompactSource === ASSUMED_WINDOW_SOURCE
  )
    return null;
  return { model, limit };
}

/**
 * The window the CLI named before the job for exactly the current model.
 * The answers of one selection may differ by a suffix such as `[1m]`; any
 * other model, such as a fallback, has no window until its `result`.
 */
function startWindow(session) {
  const { window, model } = session;
  if (window === null || model === null) return null;
  return window.model.replace(SELECTION_SUFFIX, "") ===
    model.replace(SELECTION_SUFFIX, "")
    ? window.limit
    : null;
}

/** A new model ends every value measured for the previous one. */
function observeModel(session, model) {
  if (model === null || model === session.model) return false;
  session.model = model;
  session.context = null;
  session.limit = startWindow(session);
  return true;
}

function readAnswer(event, session) {
  if (
    event.parent_tool_use_id !== null &&
    event.parent_tool_use_id !== undefined
  )
    return false;
  const model = claudeModelName(event.message?.model);
  if (model === null) return false;
  observeModel(session, model);
  session.context = {
    used: occupancy(event.message?.usage),
    source: "cli_assistant_usage",
  };
  return true;
}

/**
 * The counters an answer ended with.
 * The `assistant` event is sent while the answer streams and holds the output
 * tokens counted so far, so the `message_delta` of the same answer, which
 * names the final counters, completes the reading.
 */
function readAnswerEnd(event, session) {
  if (
    event.parent_tool_use_id !== null &&
    event.parent_tool_use_id !== undefined
  )
    return false;
  if (event.event?.type !== "message_delta" || session.model === null)
    return false;
  const used = occupancy(event.event.usage);
  if (used === null) return false;
  session.context = { used, source: "cli_assistant_usage" };
  return true;
}

function readSystem(event, session) {
  if (event.subtype === "init")
    return observeModel(session, claudeModelName(event.model));
  if (event.subtype !== "compact_boundary") return false;
  // A compaction frees context but keeps the window; without a retained count it is unknown.
  session.context = {
    used: positive(event.compact_metadata?.post_tokens),
    source: "cli_compact_boundary",
  };
  return true;
}

function readResult(event, session) {
  const limit = contextWindow(event.modelUsage, session.model);
  if (limit === null || limit === session.limit) return false;
  session.limit = limit;
  return true;
}

function reading(session) {
  return {
    session: {
      model: session.model,
      context:
        session.context || session.limit !== null
          ? {
              used: session.context?.used ?? null,
              limit: session.limit,
              source: session.context?.source ?? "cli_assistant_usage",
            }
          : null,
    },
  };
}

/** Creates the reader of one job; nothing is shared between jobs or runs. */
export function createClaudeSessionReader() {
  return { model: null, context: null, limit: null, window: null, last: null };
}

/**
 * Asks the CLI for the window of the job's model before the job starts, so
 * the first reading, sent with the job's `system` `init`, already names it.
 * The window of the turn's `result` replaces it. A question the CLI did not
 * answer leaves the window unknown until then; it never stops the job.
 * @param session - The reader of the job.
 * @param ask - Starts the CLI with the job's model and environment and
 * returns its output for {@link CLAUDE_WINDOW_REQUEST}, or `null`.
 */
export async function prepareClaudeSession(session, ask) {
  try {
    session.window = readClaudeWindow(await ask());
  } catch {
    // Without an answer the window stays unknown until the turn's result names it.
    session.window = null;
  }
}

/**
 * Emits a session reading when a Claude CLI event changed the model or the context.
 * The reading names its source; no value is derived from summed tokens, and a
 * value the CLI did not report stays `null`.
 */
export async function receiveClaudeSession(event, session, emit) {
  let hasChanged = false;
  if (event?.type === "assistant") hasChanged = readAnswer(event, session);
  else if (event?.type === "stream_event")
    hasChanged = readAnswerEnd(event, session);
  else if (event?.type === "system") hasChanged = readSystem(event, session);
  else if (event?.type === "result") hasChanged = readResult(event, session);
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
