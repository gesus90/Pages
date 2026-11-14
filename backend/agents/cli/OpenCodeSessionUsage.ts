import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** One assistant message in OpenCode's own session database. */
export interface OpenCodeMessageUsage {
  readonly id: string;
  readonly sessionId: string;
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly costUsd: number | null;
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

function cost(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    ? input
    : null;
}

/** Reads one native assistant row without trusting its JSON shape. */
export function readOpenCodeMessage(
  row: Record<string, unknown>,
): OpenCodeMessageUsage | null {
  if (typeof row.id !== "string" || typeof row.session_id !== "string")
    return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row.data));
  } catch {
    return null;
  }
  const details = record(parsed);
  if (details?.role !== "assistant") return null;
  const tokens = record(details.tokens);
  const cache = record(tokens?.cache);
  const provider = details.providerID;
  const modelId = details.modelID;
  const model =
    typeof provider === "string" && typeof modelId === "string"
      ? `${provider}/${modelId}`
      : null;
  return {
    id: row.id,
    sessionId: row.session_id,
    model,
    inputTokens: count(tokens?.input),
    outputTokens: count(tokens?.output),
    reasoningTokens: count(tokens?.reasoning),
    cacheReadTokens: count(cache?.read),
    cacheWriteTokens: count(cache?.write),
    costUsd: cost(details.cost),
  };
}

/**
 * Reads assistant usage from the native session and every descendant session.
 * OpenCode updates a message in place while it works; its ID remains stable.
 */
export function readOpenCodeSessionUsage(
  databasePath: string,
  sessionId: string,
): readonly OpenCodeMessageUsage[] {
  if (!existsSync(databasePath)) return [];
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `WITH RECURSIVE owned(id) AS (
            SELECT id FROM session WHERE id = ?
            UNION ALL
            SELECT child.id FROM session child
            INNER JOIN owned ON child.parent_id = owned.id
        )
        SELECT message.id, message.session_id, message.data
        FROM message
        INNER JOIN owned ON owned.id = message.session_id
        ORDER BY message.time_created, message.id`,
      )
      .all(sessionId);
    return rows.flatMap((row) => {
      const usage = readOpenCodeMessage(row);
      return usage === null ? [] : [usage];
    });
  } finally {
    database.close();
  }
}
