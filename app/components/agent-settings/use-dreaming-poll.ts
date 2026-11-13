import { useEffect, useState } from "react";

import { readAgentDreamingOverview } from "./agent-dreaming-api";

import type { AgentDreamingOverview } from "@/definition/AgentDreaming";
import type { Dispatch, SetStateAction } from "react";

/** How often the overview is read again while a run is going on or waits, in milliseconds. */
export const DREAMING_POLL_MS = 4_000;

interface DreamingPollOptions {
  readonly agentId: string;
  /** Whether a run is going on or waits; polling stops when it does not. */
  readonly isActive: boolean;
  readonly intervalMs: number;
  readonly setOverview: Dispatch<SetStateAction<AgentDreamingOverview | null>>;
}

/**
 * Reads the Dreaming of an agent again and again while a run is going on or
 * waits for a quiet moment, so that the tab shows the end of the run.
 *
 * @remarks
 * One timer runs at a time: it fires, reads the overview and, once the answer
 * is in, the next one is set. A failed read just tries again at the next turn.
 * The timer and the request end with the tab.
 *
 * @param options - Which agent to ask, whether to ask, how often, and where
 * the answer goes.
 */
export function useDreamingPoll({
  agentId,
  isActive,
  intervalMs,
  setOverview,
}: DreamingPollOptions): void {
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!isActive) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void readAgentDreamingOverview(agentId, controller.signal)
        .then((response) => {
          if (!controller.signal.aborted && response.ok)
            setOverview(response.overview);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            console.warn("[pages] Dreaming could not be read again.", error);
        })
        .finally(() => {
          if (!controller.signal.aborted) setRound((turn) => turn + 1);
        });
    }, intervalMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [agentId, isActive, intervalMs, setOverview, round]);
}
