import type {
  AgentSessionActionResult,
  AgentSessionReadResult,
} from "@/app/lib/agent-session-response";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

// The browser retains one visible window; older events stay in the server journal.
const MAXIMUM_EVENTS = 150;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failure(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body)
    return String(body.error);
  return fallback;
}

/**
 * Reads the view and one history page of a session after a cursor.
 *
 * @param address - The session's route, from `sessionAddress`.
 * @param after - The last sequence the console holds.
 * @param signal - Aborts the read when the console switches or closes.
 */
export async function readSessionPage(
  address: string,
  after: number,
  signal: AbortSignal,
  window: { readonly before?: number; readonly tail?: boolean } = {},
): Promise<AgentSessionReadResult> {
  let response: Response;
  try {
    const query = new URLSearchParams({ after: String(after) });
    if (window.before !== undefined) query.set("before", String(window.before));
    if (window.tail) query.set("tail", "1");
    response = await fetch(`${address}&${query}`, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    return { ok: false, error: signal.aborted ? "cancelled" : "offline" };
  }
  const body = await readJson(response);
  if (!response.ok || body === null)
    return { ok: false, error: failure(body, "general") };
  // The route answers with this contract; it is the console's own backend.
  return body as AgentSessionReadResult;
}

/**
 * Sends an instruction or a cancel to a session; success only once the backend confirmed it.
 *
 * @param address - The session's route, from `sessionAddress`.
 * @param fields - Intent and its fields.
 */
export async function postSessionCommand(
  address: string,
  fields: Readonly<Record<string, string>>,
): Promise<AgentSessionActionResult> {
  const form = new FormData();
  for (const [name, entry] of Object.entries(fields)) form.set(name, entry);
  let response: Response;
  try {
    response = await fetch(address, { method: "POST", body: form });
  } catch {
    return { ok: false, intent: fields.intent ?? "", error: "offline" };
  }
  const body = await readJson(response);
  if (!response.ok || body === null)
    return {
      ok: false,
      intent: fields.intent ?? "",
      error: failure(body, "general"),
    };
  return body as AgentSessionActionResult;
}

/**
 * Appends events in sequence order, each once.
 *
 * @remarks
 * Pages and the live stream overlap after a reconnect; an event the console
 * already holds is dropped instead of drawn twice.
 */
export function mergeEvents(
  current: readonly AgentSessionEvent[],
  incoming: readonly AgentSessionEvent[],
): readonly AgentSessionEvent[] {
  const unique = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) unique.set(event.sequence, event);
  return [...unique.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-MAXIMUM_EVENTS);
}
