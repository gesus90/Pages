import { createHash } from "node:crypto";

function count(input) {
  return Number.isSafeInteger(input) && input >= 0 ? input : null;
}

/** Only reported counters are retained; missing readings never become zero. */
export function nativeUsage(usage, tool = "codex") {
  const inputTokens = count(usage?.input_tokens);
  const outputTokens = count(usage?.output_tokens);
  const cacheReadTokens = count(
    usage?.cached_input_tokens ?? usage?.cache_read_input_tokens,
  );
  const cacheWriteTokens = count(usage?.cache_creation_input_tokens);
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

function claudeUsage(event, state) {
  if (event.type === "assistant" && event.message?.id && event.message.usage) {
    if (
      state.usageMessages.size >= 10000 &&
      !state.usageMessages.has(event.message.id)
    )
      return null;
    state.usageMessages.set(
      event.message.id,
      nativeUsage(event.message.usage, "claude"),
    );
    return sumMessages(state.usageMessages.values());
  }
  return event.type === "result" ? claudeResultUsage(event) : null;
}

/** A final Claude receipt includes the authoritative per-model totals, including subagents. */
export function claudeResultUsage(event) {
  if (!event.modelUsage) return nativeUsage(event.usage, "claude");
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

/** Normalizes the same native counters transported by the local adapters. */
export async function receiveUsage(event, tool, state) {
  let usage = null;
  if (tool === "claude") usage = claudeUsage(event, state);
  else if (
    tool === "codex" &&
    ["turn.completed", "turn.failed"].includes(event.type)
  )
    usage = nativeUsage(event.usage);
  else if (event.type === "pages.result" && event.usage)
    usage = nativeUsage({
      input_tokens: event.usage.inputTokens,
      output_tokens: event.usage.outputTokens,
      cached_input_tokens: event.usage.cachedReadTokens,
      cache_creation_input_tokens: event.usage.cachedWriteTokens,
      total_tokens: event.usage.totalTokens,
    });
  if (!usage || Object.values(usage).every((reading) => reading === null))
    return;
  const claudeObservation =
    state.isManaged && tool === "claude" ? claudeObservationOf(event) : null;
  const readings = claudeObservation
    ? claudeObservation.models.map((model, index) => ({
        ...usage,
        claudeObservation: {
          ...claudeObservation,
          id: `${claudeObservation.id}:${index}`,
          models: [model],
        },
      }))
    : [usage];
  for (const reading of readings)
    await state.emit({
      kind: "usage",
      text: JSON.stringify(reading),
      createdAt: new Date().toISOString(),
      isTruncated: false,
      channel: "stdout",
    });
}

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
    kind: "message",
    models,
    id: `runner:${event.uuid ?? createHash("sha256").update(JSON.stringify(event)).digest("hex")}`,
  };
}
