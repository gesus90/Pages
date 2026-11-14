import { useRef, useState } from "react";

import { sendAgentSessionRequest } from "./agent-session-api";

import type { AgentSessionRequest } from "./agent-session-api";
import type {
  AgentChatSessionFailure,
  AgentChatSessionOverview,
} from "@/definition/AgentChatSession";

/** The running and the failed change of the chat sessions of an agent. */
export interface AgentSessionRequestState {
  /** What runs now: `<sessionId>:<intent>` or `settings`; `null` while idle. */
  readonly pendingKey: string | null;
  /** Why the last change was refused; `null` when it worked or none ran. */
  readonly failure: AgentChatSessionFailure | null;
  /** Starts a change; ignored while another one runs. */
  send(request: AgentSessionRequest): void;
}

/**
 * The key of a change, which names the button that shows it running.
 *
 * @param request - The change.
 */
export function agentSessionRequestKey(request: AgentSessionRequest): string {
  return request.intent === "save-settings"
    ? "settings"
    : `${request.sessionId}:${request.intent}`;
}

/**
 * Sends changes of the chat sessions of an agent one at a time (PAGE-376).
 *
 * @param onChanged - Called with the fresh overview the server answers a
 * change with, and with the change it answers.
 * @returns The running change, the last failure and the way to send one.
 */
export function useAgentSessionRequest(
  onChanged: (
    overview: AgentChatSessionOverview,
    request: AgentSessionRequest,
  ) => void,
): AgentSessionRequestState {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<AgentChatSessionFailure | null>(null);
  // Two clicks inside one render must not send two changes.
  const isRunning = useRef(false);

  async function run(request: AgentSessionRequest): Promise<void> {
    isRunning.current = true;
    setPendingKey(agentSessionRequestKey(request));
    setFailure(null);
    try {
      const response = await sendAgentSessionRequest(request);
      if (response.ok) onChanged(response.overview, request);
      else setFailure(response.error);
    } catch (error: unknown) {
      console.warn("[pages] The chat session request failed.", error);
      setFailure("unavailable");
    } finally {
      isRunning.current = false;
      setPendingKey(null);
    }
  }

  function send(request: AgentSessionRequest): void {
    if (isRunning.current) return;
    void run(request);
  }

  return { pendingKey, failure, send };
}
