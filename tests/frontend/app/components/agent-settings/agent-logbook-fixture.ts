import { vi } from "vitest";

import { sessionOverview } from "./agent-session-fixture";

import type { EndpointCall } from "./agent-session-fixture";
import type {
  AgentLogbookEntryView,
  AgentLogbookOverview,
  AgentLogbookResponse,
} from "@/definition/AgentLogbook";

/** An entry of the Lagebuch of the agent `ed`; `overrides` change single fields. */
export function logbookEntry(
  id: string,
  overrides: Partial<AgentLogbookEntryView> = {},
): AgentLogbookEntryView {
  return {
    id,
    kind: "decision",
    text: "PAGE-370 übernimmt Ed bis Freitag.",
    topic: "PAGE-370",
    at: "2026-11-13T17:05:00.000Z",
    source: { kind: "group", id: "g1", name: "Pages-Team" },
    participants: ["Igor", "Mei"],
    origin: "agent",
    ...overrides,
  };
}

/** The Lagebuch of the agent `ed`; `overrides` change single fields. */
export function logbookOverview(
  overrides: Partial<AgentLogbookOverview> = {},
): AgentLogbookOverview {
  return {
    agentId: "ed",
    agentName: "Ed",
    entries: [],
    count: 0,
    fillPercent: 0,
    settings: { limit: 200, quietMinutes: 2, model: null },
    instanceModel: null,
    models: [],
    chats: [],
    canChangeSettings: true,
    ...overrides,
  };
}

function formFields(body: unknown): Record<string, string> {
  if (!(body instanceof FormData)) return {};
  return Object.fromEntries(
    [...body.entries()].map(([name, value]) => [name, String(value)]),
  );
}

/** The fields of a form body with the same name, in order. */
export function allFields(body: unknown, name: string): string[] {
  return body instanceof FormData
    ? body.getAll(name).map((value) => String(value))
    : [];
}

/**
 * Replaces `fetch` by the endpoints of the popup: the Lagebuch answers with
 * what `answer` returns, the sessions with an empty overview. Every call of
 * the Lagebuch is recorded. Undo with `vi.unstubAllGlobals()`.
 */
export function stubLogbookEndpoint(
  answer: (
    call: EndpointCall,
  ) => AgentLogbookResponse | Promise<AgentLogbookResponse> | Response,
): { readonly calls: EndpointCall[]; readonly bodies: unknown[] } {
  const calls: EndpointCall[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      if (!url.startsWith("/chat-page-api/agent-logbook"))
        return Response.json({ ok: true, overview: sessionOverview() });
      const call: EndpointCall = {
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        fields: formFields(init.body),
      };
      calls.push(call);
      bodies.push(init.body);
      const answered = await answer(call);
      return answered instanceof Response ? answered : Response.json(answered);
    },
  );
  return { calls, bodies };
}
