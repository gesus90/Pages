import type { WikiTicketSummary } from "@/definition/Wiki";

/** What a ticket link knows about its ticket. */
export type TicketSummaryState =
  | { readonly status: "loading" }
  | { readonly status: "visible"; readonly summary: WikiTicketSummary }
  | { readonly status: "hidden" };

const TICKET_PATH = /^\/(?:tasks|aufgaben)\/([A-Za-z]\w*-\d+)\/?(?:[?#].*)?$/;
/** Largest number of keys the server resolves in one request. */
const BATCH_SIZE = 50;
const LOADING: TicketSummaryState = { status: "loading" };
const HIDDEN: TicketSummaryState = { status: "hidden" };

const states = new Map<string, TicketSummaryState>();
const users = new Map<string, number>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
let isScheduled = false;

/**
 * Reads the ticket key out of the address of a ticket.
 * @param path - In-app path of a link, such as `/tasks/PAGE-12`.
 * @returns The key, or `null` for every other address.
 */
export function readTicketKey(path: string): string | null {
  const [, key = null] = TICKET_PATH.exec(path) ?? [];

  return key;
}

function isSummary(value: unknown): value is WikiTicketSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "key" in value &&
    typeof value.key === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "statusKey" in value &&
    typeof value.statusKey === "string" &&
    "statusName" in value &&
    typeof value.statusName === "string"
  );
}

function readSummaries(body: unknown): WikiTicketSummary[] | null {
  const tickets =
    typeof body === "object" && body !== null && "tickets" in body
      ? body.tickets
      : null;

  return Array.isArray(tickets) ? tickets.filter(isSummary) : null;
}

async function fetchSummaries(
  keys: readonly string[],
): Promise<WikiTicketSummary[] | null> {
  try {
    const response = await fetch(
      `/wiki-api/ticket-summaries?keys=${encodeURIComponent(keys.join(","))}`,
      { cache: "no-store" },
    );

    return response.ok ? readSummaries(await response.json()) : null;
  } catch (error: unknown) {
    console.warn("Pages could not read the tickets of the wiki links.", error);

    return null;
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function isSameSummary(
  current: TicketSummaryState | undefined,
  next: WikiTicketSummary,
): boolean {
  if (current?.status !== "visible") {
    return false;
  }

  const { summary } = current;

  return (
    summary.title === next.title &&
    summary.statusKey === next.statusKey &&
    summary.statusName === next.statusName &&
    summary.assigneeName === next.assigneeName &&
    summary.milestoneName === next.milestoneName
  );
}

/** Applies one answer at once, so every link changes in a single step. */
function apply(
  keys: readonly string[],
  summaries: readonly WikiTicketSummary[],
): void {
  const byKey = new Map(summaries.map((summary) => [summary.key, summary]));
  let hasChanged = false;

  for (const key of keys) {
    const summary = byKey.get(key);
    const current = states.get(key);

    if (summary === undefined) {
      hasChanged ||= current !== HIDDEN;
      states.set(key, HIDDEN);
    } else if (!isSameSummary(current, summary)) {
      hasChanged = true;
      states.set(key, { status: "visible", summary });
    }
  }

  if (hasChanged) {
    notify();
  }
}

async function flush(): Promise<void> {
  const keys = [...pending];

  pending.clear();
  isScheduled = false;

  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const batch = keys.slice(start, start + BATCH_SIZE);
    const summaries = await fetchSummaries(batch);

    // A failed request keeps what the links showed before.
    if (summaries !== null) {
      apply(batch, summaries);
    }
  }
}

function schedule(key: string): void {
  pending.add(key);

  if (!isScheduled) {
    isScheduled = true;
    setTimeout(() => void flush(), 0);
  }
}

/**
 * Registers a link that shows a ticket and reads the ticket when it is not
 * known yet.
 * @param key - Ticket key of the link.
 * @returns Unregisters the link again.
 * @remarks
 * Links that are shown at the same moment share one request.
 */
export function watchTicketSummary(key: string): () => void {
  users.set(key, (users.get(key) ?? 0) + 1);

  if (!states.has(key)) {
    states.set(key, LOADING);
    schedule(key);
  }

  return () => {
    const count = (users.get(key) ?? 1) - 1;

    if (count > 0) {
      users.set(key, count);
    } else {
      users.delete(key);
    }
  };
}

/**
 * Reads the tickets of every shown link again, quietly: the links keep what
 * they show until the answer replaces it in one step.
 */
export function refreshTicketSummaries(): void {
  for (const key of users.keys()) {
    schedule(key);
  }
}

/**
 * Tells what a link knows about its ticket.
 * @param key - Ticket key.
 * @returns The current state; `loading` until the server answered.
 */
export function getTicketSummary(key: string): TicketSummaryState {
  return states.get(key) ?? LOADING;
}

/**
 * Subscribes to changes of the ticket states.
 * @param listener - Called after every answer that changed a state.
 * @returns Unsubscribes the listener.
 */
export function subscribeTicketSummaries(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
