import { useState } from "react";

import { sessionAddress } from "./console-target";
import { postSessionCommand } from "./session-client";

import type { AgentSessionActionResult } from "@/app/lib/agent-session-response";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";

/** What the console says about the last command, once the backend answered. */
export interface SessionNotice {
  readonly tone: "status" | "alert";
  /** A translation key below `plans.console.result`, or an error code. */
  readonly code: string;
}

/** Sending and cancelling with one command at a time. */
export interface SessionCommands {
  readonly isPending: boolean;
  readonly notice: SessionNotice | null;
  readonly send: (text: string) => Promise<boolean>;
  readonly cancel: (scope: "turn" | "run") => Promise<void>;
}

function noticeOf(result: AgentSessionActionResult): SessionNotice {
  if (!result.ok) return { tone: "alert", code: result.error };
  if (result.intent === "send")
    return { tone: "status", code: result.delivery };
  return { tone: "status", code: result.outcome };
}

/**
 * Sends instructions to and cancels a session through the PageAgentCLI route.
 *
 * @param key - The session.
 * @param onSettled - Reads the session again once the backend answered.
 * @remarks
 * Success shows only after the backend confirmed it; a running command
 * blocks the next one, so the console never sends two writes at once.
 */
export function useSessionCommands(
  key: AgentSessionKey,
  onSettled: () => void,
): SessionCommands {
  const [isPending, setPending] = useState(false);
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  async function run(
    fields: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    if (isPending) return false;
    setPending(true);
    setNotice(null);
    try {
      const result = await postSessionCommand(sessionAddress(key), fields);
      setNotice(noticeOf(result));
      return result.ok;
    } finally {
      setPending(false);
      onSettled();
    }
  }
  return {
    isPending,
    notice,
    send: (text) => run({ intent: "send", text }),
    cancel: async (scope) => {
      await run({ intent: "cancel", scope });
    },
  };
}
