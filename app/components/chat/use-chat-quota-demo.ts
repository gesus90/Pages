import { useState } from "react";

import type { ChatNotice } from "./use-chat-commands";

/** The chat command that starts the simulated quota state; it never reaches the server. */
export const QUOTA_DEMO_COMMAND = "/quota";

/**
 * What the demonstration shows: a used-up quota, or a runner such as OpenCode
 * that reports no budget at all.
 */
export type ChatQuotaDemoKind = "exhausted" | "unreported";

/** A message the simulated quota held back instead of sending it. */
export interface ChatQuotaDemoHold {
  readonly sessionId: string;
  /** Milliseconds since the epoch. */
  readonly heldAt: number;
}

/**
 * The simulated quota state of the panel (PAGE-96).
 *
 * @remarks
 * It exists only in this browser tab and is never read from or sent to a
 * provider; reloading the page ends it.
 */
export interface ChatQuotaDemoState {
  readonly kind: ChatQuotaDemoKind;
  /** When the shown state began, in milliseconds since the epoch. */
  readonly since: number;
  /** When the person refreshed the state last, in milliseconds since the epoch. */
  readonly checkedAt: number;
  /** The last message held back while the simulated quota is used up. */
  readonly hold: ChatQuotaDemoHold | null;
}

/** The simulated quota state and what the person can do with it. */
export interface ChatQuotaDemo {
  readonly state: ChatQuotaDemoState | null;
  /** Messages are held back only while the simulated quota is used up. */
  readonly isHolding: boolean;
  /** Starts, or starts again, with a used-up quota. */
  start(): void;
  /** Reads the simulated state again; it changes only by a reset or a switch. */
  refresh(): void;
  /** Ends the demonstration; nothing held back is sent on its own. */
  reset(): void;
  /** Switches between a used-up quota and a runner without a budget report. */
  switchKind(): void;
  /** Keeps a message of the session out of the agent's reach. */
  hold(sessionId: string): void;
}

interface ChatQuotaDemoOptions {
  readonly setNotice: (notice: ChatNotice | null) => void;
}

function startedState(kind: ChatQuotaDemoKind): ChatQuotaDemoState {
  const now = Date.now();
  return { kind, since: now, checkedAt: now, hold: null };
}

/** Whether a typed text is the command of the demonstration. */
export function isQuotaDemoCommand(text: string): boolean {
  return text.trim().toLowerCase() === QUOTA_DEMO_COMMAND;
}

/**
 * The held message of the open session, shown with Pica's simulated answer.
 *
 * @param demo - The simulated quota state of the panel.
 * @param sessionId - The open session.
 */
export function shownQuotaDemoHold(
  demo: ChatQuotaDemo,
  sessionId: string | undefined,
): ChatQuotaDemoHold | null {
  const hold = demo.state?.hold ?? null;
  return hold !== null && hold.sessionId === sessionId ? hold : null;
}

/**
 * A simulated quota state for demonstrating how Pica reports a used-up quota
 * (PAGE-96).
 *
 * @remarks
 * No provider is asked; the state is local to the panel and marked as a
 * demonstration wherever it shows. A held-back message stays in the input and
 * the conversation stays unchanged; only sending it again asks the agent.
 */
export function useChatQuotaDemo({
  setNotice,
}: ChatQuotaDemoOptions): ChatQuotaDemo {
  const [state, setState] = useState<ChatQuotaDemoState | null>(null);

  function start(): void {
    setState(startedState("exhausted"));
  }

  function refresh(): void {
    const checkedAt = Date.now();
    setState((current) =>
      current === null ? null : { ...current, checkedAt },
    );
  }

  function reset(): void {
    setState(null);
    setNotice("quotaDemoReset");
  }

  function switchKind(): void {
    if (state === null) return;
    setState(
      startedState(state.kind === "exhausted" ? "unreported" : "exhausted"),
    );
  }

  function hold(sessionId: string): void {
    const heldAt = Date.now();
    setState((current) =>
      current === null ? null : { ...current, hold: { sessionId, heldAt } },
    );
  }

  return {
    state,
    isHolding: state?.kind === "exhausted",
    start,
    refresh,
    reset,
    switchKind,
    hold,
  };
}
