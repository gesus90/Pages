import { useEffect, useRef, useState } from "react";

import {
  readAgentDreamingOverview,
  sendAgentDreamingRequest,
} from "./agent-dreaming-api";
import { DREAMING_POLL_MS, useDreamingPoll } from "./use-dreaming-poll";

import type {
  AgentDreamSettings,
  AgentDreamingRequest,
} from "./agent-dreaming-api";
import type {
  AgentDreamingFailure,
  AgentDreamingOverview,
} from "@/definition/AgentDreaming";

/** What the last change did: it saved the schedule, or started a run now or left it waiting. */
export type AgentDreamingOutcome = "saved" | "started" | "waiting";

/** What a change did and which run was the last one when it did it. */
interface StoredOutcome {
  readonly outcome: AgentDreamingOutcome;
  readonly lastRunAt: string | null;
}

/**
 * The outcome while it still holds: "saved" until the next change, a run
 * until the run it asked for has ended or, when it waited, has begun.
 */
function readOutcome(
  stored: StoredOutcome | null,
  overview: AgentDreamingOverview | null,
): AgentDreamingOutcome | null {
  if (stored === null || overview === null) return null;
  if (stored.outcome === "saved") return "saved";
  if (stored.outcome === "waiting" && overview.isRunning) return null;
  return (overview.lastRun?.at ?? null) === stored.lastRunAt
    ? stored.outcome
    : null;
}

/** What the tab "Dreaming" knows and can do for one agent. */
export interface AgentDreamingState {
  /** The overview of the last read or change; `null` before the first answer. */
  readonly overview: AgentDreamingOverview | null;
  /** Why the overview could not be read; `null` when it was. */
  readonly loadFailure: AgentDreamingFailure | null;
  /** The change that runs now; `null` while idle. */
  readonly pendingKey: "settings" | "run" | null;
  /** Why the last change was refused; `null` when it worked or none ran. */
  readonly failure: AgentDreamingFailure | null;
  /** What the last change did; `null` when it failed or none ran. */
  readonly outcome: AgentDreamingOutcome | null;
  /** Reads the overview again after a failure. */
  reload(): void;
  /** Saves the schedule and the model of the dream run. */
  saveSettings(settings: AgentDreamSettings): void;
  /** Starts a dream run at once. */
  runNow(): void;
}

/**
 * Reads the Dreaming of an agent, saves its schedule and starts a run
 * (PAGE-378).
 *
 * @remarks
 * Every answer of a change carries the fresh overview, which replaces the
 * shown one; nothing is merged on the client. While a run is going on or waits
 * for a quiet moment, the overview is read again every few seconds.
 *
 * @param agentId - The agent whose Dreaming the tab shows.
 * @param pollIntervalMs - How often the overview is read again while a run is
 * going on or waits.
 */
export function useAgentDreaming(
  agentId: string,
  pollIntervalMs: number = DREAMING_POLL_MS,
): AgentDreamingState {
  const [overview, setOverview] = useState<AgentDreamingOverview | null>(null);
  const [loadFailure, setLoadFailure] = useState<AgentDreamingFailure | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingKey, setPendingKey] = useState<"settings" | "run" | null>(null);
  const [failure, setFailure] = useState<AgentDreamingFailure | null>(null);
  const [stored, setStored] = useState<StoredOutcome | null>(null);
  // Two clicks inside one render must not send two changes.
  const isSending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setOverview(null);
    setLoadFailure(null);
    void readAgentDreamingOverview(agentId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.ok) setOverview(response.overview);
        else setLoadFailure(response.error);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] Dreaming could not be read.", error);
        setLoadFailure("unavailable");
      });
    return () => controller.abort();
  }, [agentId, reloadKey]);

  useDreamingPoll({
    agentId,
    isActive: overview?.isRunning === true || overview?.isWaiting === true,
    intervalMs: pollIntervalMs,
    setOverview,
  });

  async function run(request: AgentDreamingRequest): Promise<void> {
    isSending.current = true;
    setPendingKey(request.intent === "save-settings" ? "settings" : "run");
    setFailure(null);
    setStored(null);
    try {
      const response = await sendAgentDreamingRequest(request);
      if (response.ok) {
        setOverview(response.overview);
        setStored({
          outcome:
            request.intent === "save-settings"
              ? "saved"
              : (response.run ?? "started"),
          lastRunAt: response.overview.lastRun?.at ?? null,
        });
      } else setFailure(response.error);
    } catch (error: unknown) {
      console.warn("[pages] The Dreaming request failed.", error);
      setFailure("unavailable");
    } finally {
      isSending.current = false;
      setPendingKey(null);
    }
  }

  function send(request: AgentDreamingRequest): void {
    if (isSending.current) return;
    void run(request);
  }

  return {
    overview,
    loadFailure,
    pendingKey,
    failure,
    outcome: readOutcome(stored, overview),
    reload: () => setReloadKey((key) => key + 1),
    saveSettings: (settings) =>
      send({ intent: "save-settings", agentId, settings }),
    runNow: () => send({ intent: "run-now", agentId }),
  };
}
