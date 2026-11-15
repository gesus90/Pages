import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { OpenRouterTokenCounts } from "./OpenRouterPricing";

/** One completed OpenCode assistant message, identified across repeated reads. */
export interface OpenCodeNativeMessage {
  readonly sessionId: string;
  readonly messageId: string;
  readonly model: string;
  readonly tokens: OpenRouterTokenCounts;
  readonly nativeCost: number | null;
}

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

function count(input: unknown): number | null {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : null;
}

function parseTokens(rawTokens: unknown): OpenRouterTokenCounts | null {
  const tokens = record(rawTokens);
  const cache = record(tokens?.cache);
  if (!tokens || !cache) return null;
  const input = count(tokens.input);
  const output = count(tokens.output);
  const reasoning = count(tokens.reasoning);
  const cacheRead = count(cache.read);
  const cacheWrite = count(cache.write);
  if (
    input === null ||
    output === null ||
    reasoning === null ||
    cacheRead === null ||
    cacheWrite === null
  )
    return null;
  return { input, output, reasoning, cacheRead, cacheWrite };
}

function isBillableOpenRouterMessage(
  message: Record<string, unknown> | null,
): message is Record<string, unknown> & { readonly modelID: string } {
  const time = record(message?.time);
  return (
    message?.role === "assistant" &&
    message.providerID === "openrouter" &&
    typeof message.modelID === "string" &&
    message.error === undefined &&
    typeof time?.completed === "number"
  );
}

/** Parses only a completed, billable OpenRouter assistant message. */
export function parseOpenCodeNativeMessage(
  sessionId: string,
  messageId: string,
  raw: unknown,
): OpenCodeNativeMessage | null {
  const message = record(raw);
  if (!isBillableOpenRouterMessage(message)) return null;
  const tokens = parseTokens(message.tokens);
  if (!tokens) return null;
  const nativeCost =
    typeof message.cost === "number" && Number.isFinite(message.cost)
      ? message.cost
      : null;
  return {
    sessionId,
    messageId,
    model: `openrouter/${message.modelID}`,
    tokens,
    nativeCost,
  };
}

/** Reads root and sub-session messages from this connection's native OpenCode archive. */
export function readOpenCodeNativeUsage(
  dataHome: string,
  sessionId: string,
): readonly OpenCodeNativeMessage[] {
  const database = new DatabaseSync(
    path.join(dataHome, "opencode", "opencode.db"),
    {
      readOnly: true,
    },
  );
  try {
    const rows = database
      .prepare(
        `
      WITH RECURSIVE related (id) AS (
          SELECT id FROM session WHERE id = ?
          UNION ALL
          SELECT child.id
          FROM session AS child
          INNER JOIN related ON child.parent_id = related.id
      )
      SELECT message.session_id, message.id, message.data
      FROM message
      INNER JOIN related ON related.id = message.session_id
      ORDER BY message.time_created, message.id;
    `,
      )
      .all(sessionId);
    return rows.flatMap((row) => {
      if (
        typeof row.session_id !== "string" ||
        typeof row.id !== "string" ||
        typeof row.data !== "string"
      )
        return [];
      const message = parseOpenCodeNativeMessage(
        row.session_id,
        row.id,
        JSON.parse(row.data),
      );
      return message ? [message] : [];
    });
  } finally {
    database.close();
  }
}
