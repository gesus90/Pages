import { useEffect, useRef, useState } from "react";

import { agentSessionEventSchema } from "@/definition/AgentSessionHistory";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

/** The connection state of the bounded public journal stream. */
export type SessionConnection =
  "loading" | "connecting" | "live" | "reconnecting" | "closed";

/** Opens only after the initial tail was read, so a new console never replays the whole run into the browser. */
export function useSessionStream(input: {
  readonly address: string;
  readonly isLive: boolean;
  readonly cursor: React.RefObject<number>;
  readonly onEvent: (event: AgentSessionEvent) => void;
  readonly onGap: (retainedFrom: number) => void;
  readonly onError: (error: string) => void;
}): SessionConnection {
  const [connection, setConnection] = useState<SessionConnection>("connecting");
  const [opening, setOpening] = useState(0);
  const callbacks = useRef(input);
  useEffect(() => {
    callbacks.current = input;
  });
  const { address, isLive, cursor } = input;
  useEffect(() => {
    if (!isLive) return undefined;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const source = new EventSource(`${address}&after=${cursor.current}`);
    source.onopen = () => setConnection("live");
    source.onerror = () => {
      setConnection("reconnecting");
      if (source.readyState === EventSource.CLOSED && retry === null)
        retry = setTimeout(() => setOpening((current) => current + 1), 5000);
    };
    source.addEventListener("session", (message) => {
      try {
        const parsed: unknown = JSON.parse(String(message.data));
        const event = agentSessionEventSchema.parse(parsed);
        if (event.sequence <= cursor.current) return;
        if (event.sequence !== cursor.current + 1)
          throw new Error("History sequence gap");
        cursor.current = event.sequence;
        callbacks.current.onEvent(event);
      } catch {
        callbacks.current.onError("plan_history_corrupt");
        source.close();
        setConnection("closed");
      }
    });
    source.addEventListener("history-gap", (message) => {
      try {
        const parsed: unknown = JSON.parse(String(message.data));
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("retainedFrom" in parsed) ||
          typeof parsed.retainedFrom !== "number" ||
          !Number.isSafeInteger(parsed.retainedFrom)
        )
          throw new Error("Invalid retention marker");
        cursor.current = parsed.retainedFrom - 1;
        callbacks.current.onGap(parsed.retainedFrom);
      } catch {
        callbacks.current.onError("plan_history_corrupt");
      }
    });
    source.addEventListener("history-error", (message) => {
      let code = "plan_history_unavailable";
      try {
        const parsed: unknown = JSON.parse(String(message.data));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed &&
          typeof parsed.error === "string" &&
          [
            "plan_history_unavailable",
            "plan_history_corrupt",
            "plan_invalid",
            "plan_access_denied",
          ].includes(parsed.error)
        )
          code = parsed.error;
      } catch {
        code = "plan_history_corrupt";
      }
      callbacks.current.onError(code);
      source.close();
      setConnection("closed");
    });
    return () => {
      source.close();
      if (retry !== null) clearTimeout(retry);
    };
  }, [address, isLive, cursor, opening]);
  return isLive ? connection : "closed";
}
