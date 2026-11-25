import { createHash, randomUUID } from "node:crypto";

import { SYNTHETIC_MODEL, claudeModelName } from "./claude-session.mjs";
import { codexTurnUsage } from "./codex-session.mjs";

/** The answers of one Claude job whose counters are kept; later ones are not counted before the result. */
const MAXIMUM_CLAUDE_MESSAGES = 10000;
const TOKEN_COUNTERS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
];
/** The name of counters whose answer named no usable model; Pages has no price for it. */
const UNKNOWN_CLAUDE_MODEL = "unknown";

function count(input) {
  return Number.isSafeInteger(input) && input >= 0 ? input : null;
}

/**
 * Only reported counters are retained; missing readings never become zero.
 * Codex names its cache writes `cache_write_input_tokens` and reports them
 * with every count, also as 0; its input contains the cache reads, so its
 * total stays input plus output.
 */
export function nativeUsage(usage, tool = "codex") {
  const inputTokens = count(usage?.input_tokens);
  const outputTokens = count(usage?.output_tokens);
  const cacheReadTokens = count(
    usage?.cached_input_tokens ?? usage?.cache_read_input_tokens,
  );
  const cacheWriteTokens = count(
    usage?.cache_creation_input_tokens ?? usage?.cache_write_input_tokens,
  );
  const counts =
    tool === "claude"
      ? [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]
      : [inputTokens, outputTokens];
  const total = counts.every((reading) => reading !== null)
    ? count(counts.reduce((sum, reading) => sum + reading, 0))
    : null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: count(usage?.total_tokens) ?? total,
  };
}

function sumMessages(messages) {
  const readingsByMessage = [...messages];
  const totals = {};
  for (const field of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens",
  ]) {
    const readings = readingsByMessage.map((usage) => usage[field]);
    totals[field] =
      readings.length && readings.every((reading) => reading !== null)
        ? count(readings.reduce((total, reading) => total + reading, 0))
        : null;
  }
  return totals;
}

/**
 * Creates the token reader of one Claude job; nothing is shared between jobs.
 * `key` names the interim readings since the last result in the session
 * ledger of Pages, so a later result or job of the same native session never
 * replaces them. `settled` holds the counters of the job up to that result.
 */
export function createClaudeUsageReader(command) {
  return {
    messages: new Map(),
    streams: new Map(),
    sent: new Map(),
    key: randomUUID(),
    settled: null,
    resultId: null,
    isResumed: Boolean(command.continuation?.resumeSessionId),
  };
}

/**
 * The counters of one answer after a further report of it. The CLI reports an
 * answer when it starts, with each finished content block and when it ends;
 * a counter never falls between these reports, so the highest one holds, and
 * a counter a report lacks keeps the one reported before.
 */
function mergeClaudeCounters(previous, reported) {
  const merged = {};
  for (const field of TOKEN_COUNTERS) {
    const before = previous[field];
    const after = reported[field];
    merged[field] =
      before === null || after === null
        ? (after ?? before)
        : Math.max(before, after);
  }
  const counts = TOKEN_COUNTERS.map((field) => merged[field]);
  merged.totalTokens = counts.every((reading) => reading !== null)
    ? count(counts.reduce((sum, reading) => sum + reading, 0))
    : null;
  return merged;
}

/**
 * Keeps the counters an answer reported, under the identity of the answer.
 * @returns Whether the answer is counted; Claude's own banners, which carry
 * no real usage, and answers beyond the limit of a job are not.
 */
function noteClaudeMessage(reader, message, usage) {
  const id = message?.id;
  if (typeof id !== "string" || id === "" || !usage) return false;
  if (message.model === SYNTHETIC_MODEL) return false;
  const previous = reader.messages.get(id);
  if (!previous && reader.messages.size >= MAXIMUM_CLAUDE_MESSAGES)
    return false;
  const reported = nativeUsage(usage, "claude");
  reader.messages.set(id, {
    model: claudeModelName(message.model) ?? previous?.model ?? null,
    usage: previous ? mergeClaudeCounters(previous.usage, reported) : reported,
  });
  return true;
}

/**
 * Reads the counters of a streamed answer. `message_start` names the answer
 * with its input and cache counters and the output counted so far;
 * `message_delta` ends it with the final counters and names no answer, so it
 * belongs to the answer its stream started last. The `assistant` events in
 * between repeat the counters of the start.
 */
function readClaudeStream(event, reader) {
  const update = event.event;
  const stream = event.parent_tool_use_id ?? "";
  if (update?.type === "message_start") {
    if (
      !reader.streams.has(stream) &&
      reader.streams.size >= MAXIMUM_CLAUDE_MESSAGES
    )
      return false;
    reader.streams.set(stream, update.message?.id);
    return noteClaudeMessage(reader, update.message, update.message?.usage);
  }
  if (update?.type !== "message_delta") return false;
  const id = reader.streams.get(stream);
  // Only an answer that is counted has counters to complete.
  return (
    reader.messages.has(id) && noteClaudeMessage(reader, { id }, update.usage)
  );
}

/** The counters of the answers since the last result, per model in order of first use. */
function claudeModelSums(reader) {
  const models = new Map();
  for (const { model, usage } of reader.messages.values()) {
    const name = model ?? UNKNOWN_CLAUDE_MODEL;
    const readings = models.get(name) ?? [];
    readings.push(usage);
    models.set(name, readings);
  }
  return [...models].map(([model, readings]) => ({
    model,
    usage: sumMessages(readings),
  }));
}

/**
 * The interim readings of a running Claude turn. Every reading holds the
 * sum of all answers of the job so far and is marked as interim, because an
 * answer of a subagent reports its final output only with the result. A
 * managed job adds the sum one model reached since the last result as an
 * observation the session ledger of Pages replaces with each further reading
 * of that model and reconciles with the totals of the next result. A sum
 * that did not change is not sent again.
 */
function claudeInterimReadings(event, state) {
  const reader = state.claudeUsage;
  const total = sumMessages([
    ...(reader.settled ? [reader.settled] : []),
    ...[...reader.messages.values()].map((message) => message.usage),
  ]);
  const sessionId = event.session_id;
  const isObserved =
    state.isManaged && typeof sessionId === "string" && sessionId !== "";
  const sums = isObserved
    ? claudeModelSums(reader)
    : [{ model: "", usage: total }];
  return sums.flatMap(({ model, usage }) => {
    const text = JSON.stringify(usage);
    if (reader.sent.get(model) === text) return [];
    reader.sent.set(model, text);
    if (!isObserved) return [{ ...total, isInterim: true }];
    const tokens = Object.fromEntries(
      TOKEN_COUNTERS.map((field) => [field, usage[field]]),
    );
    return [
      {
        ...total,
        isInterim: true,
        claudeObservation: {
          sessionId,
          kind: "message",
          id: `live:${reader.key}:${model}`.slice(0, 200),
          models: [{ model, ...tokens }],
        },
      },
    ];
  });
}

/**
 * Closes the readings of a result: the answers up to it are settled.
 * A job whose background task ends later goes on and reports a further
 * result. That result names only the answers since the one before in `usage`
 * and the whole session in `modelUsage`, so the counters of the job continue
 * from the settled ones, and the answers that follow start readings of their
 * own.
 */
function settleClaudeResult(event, reader) {
  // A result reported again settles nothing new.
  if (reader.settled && event.uuid && event.uuid === reader.resultId)
    return reader.settled;
  const reported = claudeResultUsage(event, reader.isResumed);
  const isSinceLastResult = reader.isResumed || !event.modelUsage;
  const usage =
    isSinceLastResult && reader.settled
      ? sumMessages([reader.settled, reported])
      : reported;
  reader.settled = usage;
  reader.resultId = event.uuid ?? null;
  reader.messages.clear();
  reader.streams.clear();
  reader.sent.clear();
  reader.key = randomUUID();
  return usage;
}

/** The readings a Claude event adds: the interim sums of a running turn, or the counters of its result. */
function claudeReadings(event, state) {
  const reader = state.claudeUsage;
  if (event.type === "result") {
    const observation = state.isManaged ? claudeObservationOf(event) : null;
    return [
      {
        ...settleClaudeResult(event, reader),
        ...(observation ? { claudeObservation: observation } : {}),
      },
    ];
  }
  let isCounted = false;
  if (event.type === "stream_event")
    isCounted = readClaudeStream(event, reader);
  else if (event.type === "assistant")
    isCounted = noteClaudeMessage(reader, event.message, event.message?.usage);
  return isCounted ? claudeInterimReadings(event, state) : [];
}

/**
 * The counters of a final Claude receipt.
 * `modelUsage` holds the authoritative totals per model, including subagents
 * and internal calls, but for the whole native session: a job that resumed a
 * session would report the tokens of its earlier turns again. Such a job
 * reports `usage`, the counters of its own turn without subagents; Pages
 * takes the complete turn of a managed job from the difference of the totals.
 */
export function claudeResultUsage(event, isResumed = false) {
  if (!event.modelUsage || isResumed) return nativeUsage(event.usage, "claude");
  return sumMessages(
    Object.values(event.modelUsage).map((usage) =>
      nativeUsage(
        {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_read_input_tokens: usage.cacheReadInputTokens,
          cache_creation_input_tokens: usage.cacheCreationInputTokens,
        },
        "claude",
      ),
    ),
  );
}

/**
 * The counts of the model calls a running Antigravity prompt finished so far.
 * Only the three counts its conversation store names are taken: the cache
 * write count and the total come with the prompt's answer, which replaces
 * this reading, and neither is derived here.
 */
function antigravityCallUsage(event, state) {
  if (event.sessionId !== state.acpSelection?.sessionId) return null;
  return {
    inputTokens: count(event.usage?.inputTokens),
    outputTokens: count(event.usage?.outputTokens),
    cacheReadTokens: count(event.usage?.cacheReadTokens),
    cacheWriteTokens: null,
    totalTokens: null,
  };
}

/**
 * Normalizes the same native counters transported by the local adapters.
 * The counters of a Codex turn end count its whole thread, so the tokens a
 * resumed thread had used before the job are left out, as in the interim
 * readings of the running turn they replace.
 */
function nativeReading(event, tool, state) {
  if (
    tool === "codex" &&
    ["turn.completed", "turn.failed"].includes(event.type)
  )
    return nativeUsage(codexTurnUsage(state.codexSession, event.usage));
  if (tool === "antigravity" && event.type === "pages.usage")
    return antigravityCallUsage(event, state);
  if (event.type === "pages.result" && event.usage)
    return nativeUsage({
      input_tokens: event.usage.inputTokens,
      output_tokens: event.usage.outputTokens,
      cached_input_tokens: event.usage.cachedReadTokens,
      cache_creation_input_tokens: event.usage.cachedWriteTokens,
      total_tokens: event.usage.totalTokens,
    });
  return null;
}

/**
 * The usage of one model step a running OpenCode prompt finished, under the
 * identity of its native message. The session ledger of Pages stores a
 * message once, so a step that is reported again, the end of the turn and a
 * later job of the same native session never count it twice. A count the
 * step lacks stays `null`.
 */
function openCodeStepReading(event, state) {
  const step = event.message;
  if (event.sessionId !== state.acpSelection?.sessionId || !step) return null;
  if (typeof step.id !== "string" || typeof step.sessionId !== "string")
    return null;
  const { costUsd: cost, model } = step;
  return {
    openCodeMessage: {
      id: step.id.slice(0, 200),
      sessionId: step.sessionId.slice(0, 200),
      model: typeof model === "string" && model ? model.slice(0, 301) : null,
      inputTokens: count(step.inputTokens),
      outputTokens: count(step.outputTokens),
      reasoningTokens: count(step.reasoningTokens),
      cacheReadTokens: count(step.cacheReadTokens),
      cacheWriteTokens: count(step.cacheWriteTokens),
      costUsd: Number.isFinite(cost) && cost >= 0 ? cost : null,
    },
  };
}

async function emitReading(state, reading) {
  await state.emit({
    kind: "usage",
    text: JSON.stringify(reading),
    createdAt: new Date().toISOString(),
    isTruncated: false,
    channel: "stdout",
  });
}

/** Whether a reading names at least one of the five counters. */
function hasCounter(reading) {
  return [...TOKEN_COUNTERS, "totalTokens"].some(
    (field) => reading[field] !== null && reading[field] !== undefined,
  );
}

/** Sends the token counters a native event reports as `usage` events of the job history. */
export async function receiveUsage(event, tool, state) {
  if (tool === "opencode" && event.type === "pages.usage") {
    const step = openCodeStepReading(event, state);
    if (step) await emitReading(state, step);
    return;
  }
  const readings =
    tool === "claude"
      ? claudeReadings(event, state)
      : [nativeReading(event, tool, state)];
  for (const reading of readings)
    if (reading && hasCounter(reading)) await emitReading(state, reading);
}

/**
 * The totals of a managed job's result for the session ledger of Pages.
 * The CLI counts them over the whole native session, also across the jobs
 * that resumed it, so the ledger takes them as the new total of the session
 * and gives the turn the difference to the total before.
 */
function claudeObservationOf(event) {
  if (event.type !== "result" || !event.session_id || !event.modelUsage)
    return null;
  const models = Object.entries(event.modelUsage)
    .slice(0, 100)
    .map(([model, usage]) => ({
      model,
      inputTokens: count(usage.inputTokens),
      outputTokens: count(usage.outputTokens),
      cacheReadTokens: count(usage.cacheReadInputTokens),
      cacheWriteTokens: count(usage.cacheCreationInputTokens),
    }));
  if (!models.length) return null;
  return {
    sessionId: event.session_id,
    kind: "total",
    models,
    id: `runner:${event.uuid ?? createHash("sha256").update(JSON.stringify(event)).digest("hex")}`,
  };
}
