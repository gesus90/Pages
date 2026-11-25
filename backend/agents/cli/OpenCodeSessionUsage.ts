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

/**
 * Whether a row still is the placeholder of a model step that reported nothing.
 * @remarks
 * OpenCode writes the row of an assistant message when its model step starts,
 * with every count and the cost at 0. Only the end of the step replaces them
 * with the measured counts, together with the finish reason and the total.
 * Until then the zeros are no measurement, and a step that failed before its
 * end keeps them for good.
 */
function isUnreportedStep(
  details: Record<string, unknown>,
  tokens: Record<string, unknown> | null,
  cache: Record<string, unknown> | null,
): boolean {
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

/**
 * Reads one native assistant row without trusting its JSON shape.
 * @param row - A row of OpenCode's `message` table.
 * @returns The usage of the row; `null` for a row that is no assistant
 * message and for a model step that has reported nothing yet.
 */
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
  if (isUnreportedStep(details, tokens, cache)) return null;
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
