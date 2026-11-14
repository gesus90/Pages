import { useRevalidator } from "react-router";

import { useAgentSessionRequest } from "@/app/components/agent-settings/use-agent-session-request";

import type {
  AgentChatSessionAction,
  AgentChatSessionBrief,
  AgentChatSessionFailure,
} from "@/definition/AgentChatSession";

/** The change of a session of the chat page that runs and the last one that failed. */
export interface AgentSessionActions {
  /** What runs now; `null` while idle. */
  readonly pendingKey: string | null;
  readonly failure: AgentChatSessionFailure | null;
  /** Stops, summarizes or restarts the session of the chat. */
  run(action: AgentChatSessionAction, brief: AgentChatSessionBrief): void;
}

/**
 * Stops, summarizes or restarts the session of an agent in the opened chat
 * (PAGE-376).
 *
 * @remarks
 * The page reads its data again once the server accepted the change, so the
 * status in the head of the chat shows the new state of the session.
 */
export function useAgentSessionActions(): AgentSessionActions {
  const revalidator = useRevalidator();
  const request = useAgentSessionRequest(() => {
    void revalidator.revalidate();
  });

  function run(
    action: AgentChatSessionAction,
    brief: AgentChatSessionBrief,
  ): void {
    request.send({
      intent: action,
      agentId: brief.agentId,
      sessionId: brief.sessionId,
    });
  }

  return { pendingKey: request.pendingKey, failure: request.failure, run };
}
