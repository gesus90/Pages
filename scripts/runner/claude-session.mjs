/**
 * Session readings of a Claude Code CLI job: the model the CLI reported and
 * the context occupancy of the latest top-level answer, kept apart from the
 * token accounting in `usage.mjs`.
 */

/** Claude's own banners, such as a spend limit, carry no real usage. */
const SYNTHETIC_MODEL = "<synthetic>";
const MODEL_NAME = /^[A-Za-z0-9._:@/[\]-]{1,200}$/u;

function count(input) {
  return Number.isSafeInteger(input) && input >= 0 ? input : null;
}

function modelName(input) {
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

/** A new model ends every value measured for the previous one. */
function observeModel(session, model) {
  if (model === null || model === session.model) return false;
  session.model = model;
  session.context = null;
  session.limit = null;
  return true;
}

function readAnswer(event, session) {
  if (
    event.parent_tool_use_id !== null &&
    event.parent_tool_use_id !== undefined
  )
    return false;
  const model = modelName(event.message?.model);
  if (model === null) return false;
  observeModel(session, model);
  session.context = {
    used: occupancy(event.message?.usage),
    source: "cli_assistant_usage",
  };
  return true;
}

function readSystem(event, session) {
  if (event.subtype === "init")
    return observeModel(session, modelName(event.model));
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
      context: session.context
        ? {
            used: session.context.used,
            limit: session.limit,
            source: session.context.source,
          }
        : null,
    },
  };
}

/** Creates the reader of one job; nothing is shared between jobs or runs. */
export function createClaudeSessionReader() {
  return { model: null, context: null, limit: null, last: null };
}

/**
 * Emits a session reading when a Claude CLI event changed the model or the context.
 * The reading names its source; no value is derived from summed tokens, and a
 * value the CLI did not report stays `null`.
 */
export async function receiveClaudeSession(event, session, emit) {
  let hasChanged = false;
  if (event?.type === "assistant") hasChanged = readAnswer(event, session);
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
