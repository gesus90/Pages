import type {
  AgentSessionEventPage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

/** One read of a PageAgentCLI session: its view and the history after a cursor. */
export type AgentSessionReadResult =
  | {
      readonly ok: true;
      readonly view: AgentSessionView;
      readonly page: AgentSessionEventPage;
    }
  | { readonly ok: false; readonly error: string };

/** What a session operation reported; success only once the backend confirmed it. */
export type AgentSessionActionResult =
  | {
      readonly ok: true;
      readonly intent: "send";
      readonly delivery: "queued" | "started";
    }
  | {
      readonly ok: true;
      readonly intent: "cancel";
      readonly outcome: "turn_cancelled" | "run_stopped" | "nothing_running";
    }
  | { readonly ok: false; readonly intent: string; readonly error: string };
