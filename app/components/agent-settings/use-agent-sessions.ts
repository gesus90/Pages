import { useEffect, useState } from "react";

import { readAgentSessionOverview } from "./agent-session-api";
import { useAgentSessionRequest } from "./use-agent-session-request";

import type { AgentSessionRequestState } from "./use-agent-session-request";
import type {
  AgentChatSessionAction,
  AgentChatSessionFailure,
  AgentChatSessionOverview,
  AgentChatSessionSettings,
} from "@/definition/AgentChatSession";

/** What the tab "Sitzungen" knows and can do for one agent. */
export interface AgentSessionsState {
  readonly isLoading: boolean;
  /** The overview of the last read or change; `null` before the first answer. */
  readonly overview: AgentChatSessionOverview | null;
  /** Why the overview could not be read; `null` when it was. */
  readonly loadFailure: AgentChatSessionFailure | null;
  /** The change that runs now and the failure of the last one. */
  readonly request: Pick<AgentSessionRequestState, "failure" | "pendingKey">;
  /** Whether the last change saved the settings. */
  readonly hasSavedSettings: boolean;
  /** Reads the overview again after a failure. */
  reload(): void;
  /** Stops, summarizes or restarts one session. */
  runAction(action: AgentChatSessionAction, sessionId: string): void;
  /** Saves idle time and restart threshold of the agent. */
  saveSettings(settings: AgentChatSessionSettings): void;
}

interface LoadState {
  readonly isLoading: boolean;
  readonly overview: AgentChatSessionOverview | null;
  readonly failure: AgentChatSessionFailure | null;
}

const LOADING: LoadState = { isLoading: true, overview: null, failure: null };

/**
 * Reads the chat sessions of an agent and changes them (PAGE-376).
 *
 * @remarks
 * Every answer of a change carries the fresh overview, which replaces the
 * shown one; nothing is merged on the client.
 *
 * @param agentId - The agent whose sessions the tab shows.
 */
export function useAgentSessions(agentId: string): AgentSessionsState {
  const [load, setLoad] = useState<LoadState>(LOADING);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSavedSettings, setHasSavedSettings] = useState(false);
  const request = useAgentSessionRequest((overview, changed) => {
    setLoad({ isLoading: false, overview, failure: null });
    setHasSavedSettings(changed.intent === "save-settings");
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoad(LOADING);
    void readAgentSessionOverview(agentId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setLoad(
          response.ok
            ? { isLoading: false, overview: response.overview, failure: null }
            : { isLoading: false, overview: null, failure: response.error },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] The chat sessions could not be read.", error);
        setLoad({ isLoading: false, overview: null, failure: "unavailable" });
      });
    return () => controller.abort();
  }, [agentId, reloadKey]);

  function runAction(action: AgentChatSessionAction, sessionId: string): void {
    setHasSavedSettings(false);
    request.send({ intent: action, agentId, sessionId });
  }

  function saveSettings(settings: AgentChatSessionSettings): void {
    setHasSavedSettings(false);
    request.send({ intent: "save-settings", agentId, settings });
  }

  return {
    isLoading: load.isLoading,
    overview: load.overview,
    loadFailure: load.failure,
    request: { failure: request.failure, pendingKey: request.pendingKey },
    hasSavedSettings,
    reload: () => setReloadKey((key) => key + 1),
    runAction,
    saveSettings,
  };
}
