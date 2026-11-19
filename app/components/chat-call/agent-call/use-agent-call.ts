import { useEffect, useRef, useState } from "react";

import { AgentCallSession } from "./agent-call-session";

import type { AgentCallState } from "./agent-call-session";

/** The call of the opened direct chat with an agent. */
export interface AgentCallControl {
  /** The running call; `null` without one. */
  readonly state: AgentCallState | null;
  readonly start: (agentId: string) => void;
  readonly end: () => void;
  readonly toggleMute: () => void;
}

/**
 * Runs the voice call with an agent for the chat page.
 * @remarks
 * Starting is the click of the person, which is also when the browser asks for
 * the microphone. Leaving the page hangs up and releases the microphone.
 */
export function useAgentCall(): AgentCallControl {
  const [state, setState] = useState<AgentCallState | null>(null);
  const session = useRef<AgentCallSession | null>(null);

  function end(): void {
    session.current?.close();
    session.current = null;
    setState(null);
  }

  useEffect(
    () => () => {
      session.current?.close();
      session.current = null;
    },
    [],
  );

  function start(agentId: string): void {
    if (session.current !== null) return;
    const call = new AgentCallSession(agentId, (next) => {
      if (session.current === call) setState(next);
    });
    session.current = call;
    void call.start();
  }

  function toggleMute(): void {
    session.current?.setMuted(state?.microphone !== "muted");
  }

  return { state, start, end, toggleMute };
}
