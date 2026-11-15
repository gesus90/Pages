import { useRef, useState } from "react";
import { useRevalidator } from "react-router";

import { sendAgentControl } from "./agent-control-api";

import type {
  AgentChatControlFailure,
  AgentChatControlResponse,
} from "@/definition/AgentChatControl";

/** A request to the control of agents that runs, and the last one that failed. */
export interface AgentControlRequest {
  readonly isPending: boolean;
  readonly failure: AgentChatControlFailure | null;
  /** Sends a request; the page reads its data again once a change worked. */
  send(
    fields: Readonly<Record<string, string>>,
  ): Promise<AgentChatControlResponse | null>;
  clearFailure(): void;
}

/**
 * Sends requests to the control of agents in a chat one at a time (PAGE-380).
 *
 * @remarks
 * After a change the page reads its data again, so the head, the rings and
 * the system lines show the new state. A request while another runs is
 * ignored and answers `null`.
 */
export function useAgentControl(): AgentControlRequest {
  const revalidator = useRevalidator();
  const [isPending, setIsPending] = useState(false);
  const [failure, setFailure] = useState<AgentChatControlFailure | null>(null);
  const isRunning = useRef(false);

  async function send(
    fields: Readonly<Record<string, string>>,
  ): Promise<AgentChatControlResponse | null> {
    if (isRunning.current) return null;
    isRunning.current = true;
    setIsPending(true);
    setFailure(null);
    try {
      const response = await sendAgentControl(fields);
      if (!response.ok) setFailure(response.error);
      else if (fields.intent !== "models" && fields.intent !== "members")
        void revalidator.revalidate();
      return response;
    } catch (error: unknown) {
      console.warn("[pages] The request of the agent control failed.", error);
      setFailure("unavailable");
      return null;
    } finally {
      isRunning.current = false;
      setIsPending(false);
    }
  }

  return { isPending, failure, send, clearFailure: () => setFailure(null) };
}
