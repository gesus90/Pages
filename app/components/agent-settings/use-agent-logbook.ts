import { useEffect, useRef, useState } from "react";

import {
  readAgentLogbookOverview,
  sendAgentLogbookRequest,
} from "./agent-logbook-api";

import type { AgentLogbookRequest } from "./agent-logbook-api";
import type {
  AgentLogbookFailure,
  AgentLogbookOverview,
  AgentLogbookSettings,
} from "@/definition/AgentLogbook";

/** What the tab "Lagebuch" knows and can do for one agent. */
export interface AgentLogbookState {
  /** The overview of the last read or change; `null` before the first answer. */
  readonly overview: AgentLogbookOverview | null;
  /** Why the overview could not be read; `null` when it was. */
  readonly loadFailure: AgentLogbookFailure | null;
  /** The change that runs now: `settings` or `remove`; `null` while idle. */
  readonly pendingKey: "settings" | "remove" | null;
  /** Why the last change was refused; `null` when it worked or none ran. */
  readonly failure: AgentLogbookFailure | null;
  /** Whether the last change saved the settings. */
  readonly hasSavedSettings: boolean;
  /** Reads the overview again after a failure. */
  reload(): void;
  /** Saves limit, quiet time and model of the agent. */
  saveSettings(settings: AgentLogbookSettings): void;
  /** Removes entries. */
  removeEntries(entryIds: readonly string[]): void;
}

interface LoadState {
  readonly overview: AgentLogbookOverview | null;
  readonly failure: AgentLogbookFailure | null;
}

const LOADING: LoadState = { overview: null, failure: null };

/**
 * Reads the Lagebuch of an agent and changes its settings and entries
 * (PAGE-377).
 *
 * @remarks
 * Every answer of a change carries the fresh overview, which replaces the
 * shown one; nothing is merged on the client. The Lagebuch is read when the
 * tab opens, not with the popup.
 *
 * @param agentId - The agent whose Lagebuch the tab shows.
 */
export function useAgentLogbook(agentId: string): AgentLogbookState {
  const [load, setLoad] = useState<LoadState>(LOADING);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingKey, setPendingKey] = useState<"settings" | "remove" | null>(
    null,
  );
  const [failure, setFailure] = useState<AgentLogbookFailure | null>(null);
  const [hasSavedSettings, setHasSavedSettings] = useState(false);
  // Two clicks inside one render must not send two changes.
  const isRunning = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoad(LOADING);
    void readAgentLogbookOverview(agentId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLoad(
          response.ok
            ? { overview: response.overview, failure: null }
            : { overview: null, failure: response.error },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] The logbook could not be read.", error);
        setLoad({ overview: null, failure: "unavailable" });
      });
    return () => controller.abort();
  }, [agentId, reloadKey]);

  async function run(request: AgentLogbookRequest): Promise<void> {
    isRunning.current = true;
    setPendingKey(request.intent === "save-settings" ? "settings" : "remove");
    setFailure(null);
    setHasSavedSettings(false);
    try {
      const response = await sendAgentLogbookRequest(request);
      if (response.ok) {
        setLoad({ overview: response.overview, failure: null });
        setHasSavedSettings(request.intent === "save-settings");
      } else setFailure(response.error);
    } catch (error: unknown) {
      console.warn("[pages] The logbook request failed.", error);
      setFailure("unavailable");
    } finally {
      isRunning.current = false;
      setPendingKey(null);
    }
  }

  function send(request: AgentLogbookRequest): void {
    if (isRunning.current) return;
    void run(request);
  }

  return {
    overview: load.overview,
    loadFailure: load.failure,
    pendingKey,
    failure,
    hasSavedSettings,
    reload: () => setReloadKey((key) => key + 1),
    saveSettings: (settings) =>
      send({ intent: "save-settings", agentId, settings }),
    removeEntries: (entryIds) =>
      send({ intent: "remove-entries", agentId, entryIds }),
  };
}
