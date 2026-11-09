import { useEffect, useRef, useState } from "react";

import { sessionAddress } from "./console-target";
import { readSessionPage } from "./session-client";

import type {
  AgentSessionEvent,
  AgentSessionKey,
} from "@/definition/AgentSessionJournal";
import type { EarlierAttempt } from "./console-step-state";

/** What the terminal holds of one attempt beyond the live window. */
interface AttemptPages {
  readonly events: readonly AgentSessionEvent[];
  /** Nothing older is left on the server. */
  readonly isComplete: boolean;
  /** At least one page of the attempt was read. */
  readonly isLoaded: boolean;
}

/** The history of every attempt of a node, as far as the reader scrolled up. */
export interface TerminalHistory {
  /** Older events of the current attempt than its live window. */
  readonly older: readonly AgentSessionEvent[];
  /** Events of earlier attempts, by attempt. */
  readonly earlier: ReadonlyMap<string, readonly AgentSessionEvent[]>;
  readonly isLoading: boolean;
  readonly hasOlder: boolean;
  /** Reads the next older page: first of the current attempt, then of the attempts before it. */
  readonly loadOlder: () => void;
}

const EMPTY: AttemptPages = { events: [], isComplete: false, isLoaded: false };

function mergedEvents(
  current: readonly AgentSessionEvent[],
  incoming: readonly AgentSessionEvent[],
): readonly AgentSessionEvent[] {
  const unique = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) unique.set(event.sequence, event);
  return [...unique.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

/** The newest attempt whose older history is not read completely yet, newest first. */
function nextIncomplete(
  order: readonly string[],
  pages: ReadonlyMap<string, AttemptPages>,
): string | null {
  for (const attemptId of [...order].reverse())
    if (!(pages.get(attemptId) ?? EMPTY).isComplete) return attemptId;
  return null;
}

/** A resumed node reads as one history: the newest page of every earlier attempt comes at once. */
function useEarlierTails(
  key: AgentSessionKey,
  earlier: readonly EarlierAttempt[],
  setPages: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, AttemptPages>>
  >,
): void {
  const earlierIds = earlier.map((attempt) => attempt.attemptId).join(",");
  const { planId, runId, stepId } = key;
  useEffect(() => {
    const controller = new AbortController();
    for (const attemptId of earlierIds.split(",").filter(Boolean))
      void readSessionPage(
        `${sessionAddress({ planId, runId, stepId, attemptId })}&history=only`,
        0,
        controller.signal,
        { tail: true },
      ).then((result) => {
        if (!result.ok || controller.signal.aborted) return;
        setPages((previous) => {
          if (previous.get(attemptId)?.isLoaded) return previous;
          const next = new Map(previous);
          next.set(attemptId, {
            events: result.page.events,
            isComplete: result.page.hasEarlier !== true,
            isLoaded: true,
          });
          return next;
        });
      });
    return () => controller.abort();
  }, [earlierIds, planId, runId, stepId, setPages]);
}

/**
 * Pages older history into the terminal while the reader scrolls up (PAGE-284).
 *
 * @param key - The current attempt; its live window comes from the session.
 * @param options - The first sequence and the older flag of the live window, and the earlier attempts.
 * @remarks
 * The server pages each attempt with `before`; once an attempt has nothing
 * older, the newest page of the attempt before it follows, so a resumed node
 * reads as one history.
 */
export function useTerminalHistory(
  key: AgentSessionKey,
  options: {
    readonly firstSequence: number | null;
    readonly hasEarlier: boolean;
    readonly earlier: readonly EarlierAttempt[];
  },
): TerminalHistory {
  const [pages, setPages] = useState<ReadonlyMap<string, AttemptPages>>(
    new Map(),
  );
  const [isLoading, setLoading] = useState(false);
  const loading = useRef(false);
  const order = [
    ...options.earlier.map((attempt) => attempt.attemptId),
    key.attemptId,
  ];
  const current = pages.get(key.attemptId);
  const isCurrentComplete =
    current?.isComplete ??
    (!options.hasEarlier && options.firstSequence !== null);
  const effective = new Map(pages);
  effective.set(key.attemptId, {
    events: current?.events ?? [],
    isComplete: isCurrentComplete,
    isLoaded: true,
  });
  const target = nextIncomplete(order, effective);
  useEarlierTails(key, options.earlier, setPages);
  async function load(attemptId: string): Promise<void> {
    const known = effective.get(attemptId) ?? EMPTY;
    const first =
      attemptId === key.attemptId
        ? (known.events[0]?.sequence ?? options.firstSequence)
        : known.events[0]?.sequence;
    const result = await readSessionPage(
      `${sessionAddress({ ...key, attemptId })}&history=only`,
      0,
      new AbortController().signal,
      first === undefined || first === null || !known.isLoaded
        ? { tail: true }
        : { before: first },
    );
    if (!result.ok) return;
    setPages((previous) => {
      const next = new Map(previous);
      const before = previous.get(attemptId) ?? EMPTY;
      next.set(attemptId, {
        events: mergedEvents(before.events, result.page.events),
        isComplete:
          result.page.events.length === 0 || result.page.hasEarlier !== true,
        isLoaded: true,
      });
      return next;
    });
  }
  return {
    older: current?.events ?? [],
    earlier: new Map(
      options.earlier.map((attempt) => [
        attempt.attemptId,
        pages.get(attempt.attemptId)?.events ?? [],
      ]),
    ),
    isLoading,
    hasOlder: target !== null,
    loadOlder: () => {
      if (target === null || loading.current) return;
      loading.current = true;
      setLoading(true);
      void load(target).finally(() => {
        loading.current = false;
        setLoading(false);
      });
    },
  };
}
