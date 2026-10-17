import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";

/** Validated list window; the context binds a cursor to the account and query. */
export interface AgentListWindow {
  readonly cursor?: unknown;
  readonly limit?: unknown;
  readonly context: string;
  /** Preserves an existing stable repository order while keeping database positions out of cursors. */
  readonly preserveOrder?: boolean;
}

function contextHash(context: string): string {
  return createHash("sha256").update(context).digest("hex");
}

function readAfter(window: AgentListWindow): string | null {
  if (window.cursor === undefined || window.cursor === null) return null;
  if (typeof window.cursor !== "string" || window.cursor.length > 2048)
    throw new AgentOperationError("INVALID_REQUEST");
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(window.cursor, "base64url").toString("utf8"),
    );
  } catch (caughtError: unknown) {
    logCaughtError("AgentCursor", caughtError);

    throw new AgentOperationError("INVALID_REQUEST");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("context" in parsed) ||
    parsed.context !== contextHash(window.context) ||
    !("after" in parsed) ||
    typeof parsed.after !== "string"
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return parsed.after;
}

/** Pages a filtered list by identifier or its trusted repository order, with an opaque continuation. */
export function pageAgentEntries<T extends { readonly id: string }>(
  entries: readonly T[],
  window: AgentListWindow,
): {
  readonly entries: readonly T[];
  readonly total: number;
  readonly nextCursor: string | null;
} {
  const limit = window.limit === undefined ? 100 : window.limit;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const after = readAfter(window);
  const ordered = window.preserveOrder
    ? [...entries]
    : [...entries].sort((left, right) =>
        left.id < right.id ? -1 : Number(left.id > right.id),
      );
  const remaining = entriesAfter(ordered, after, window.preserveOrder ?? false);
  const selected = remaining.slice(0, limit);
  const last = selected.at(-1);
  return {
    entries: selected,
    total: entries.length,
    nextCursor:
      remaining.length > selected.length && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              context: contextHash(window.context),
              after: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}

function entriesAfter<T extends { readonly id: string }>(
  entries: readonly T[],
  after: string | null,
  preserveOrder: boolean,
): readonly T[] {
  if (after === null) return entries;
  if (!preserveOrder) return entries.filter((entry) => entry.id > after);
  const index = entries.findIndex((entry) => entry.id === after);
  if (index < 0) throw new AgentOperationError("INVALID_REQUEST");
  return entries.slice(index + 1);
}
