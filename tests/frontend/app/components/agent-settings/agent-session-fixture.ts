import { vi } from "vitest";

import type {
  AgentChatSessionBrief,
  AgentChatSessionOverview,
  AgentChatSessionResponse,
  AgentChatSessionView,
} from "@/definition/AgentChatSession";

/** A session of the agent `ed` in a direct chat; `overrides` change single fields. */
export function sessionView(
  sessionId: string,
  overrides: Partial<AgentChatSessionView> = {},
): AgentChatSessionView {
  return {
    sessionId,
    agentId: "ed",
    state: "ready",
    contextPercent: 34,
    waitingMessages: 0,
    tokens: 96_000,
    lastActivityAt: null,
    chat: {
      kind: "direct",
      id: "person-1",
      name: "Igor",
      isConfidential: false,
    },
    ...overrides,
  };
}

/** The overview of the agent `ed`; `overrides` change single fields. */
export function sessionOverview(
  overrides: Partial<AgentChatSessionOverview> = {},
): AgentChatSessionOverview {
  return {
    agentId: "ed",
    agentName: "Ed",
    sessions: [],
    openSessions: 0,
    restingSessions: 0,
    tokensToday: 0,
    settings: { idleMinutes: 30, restartPercent: 80 },
    canChangeSettings: true,
    ...overrides,
  };
}

/** The short state of a session of the agent `ed`; `overrides` change single fields. */
export function sessionBrief(
  overrides: Partial<AgentChatSessionBrief> = {},
): AgentChatSessionBrief {
  return {
    sessionId: "session-1",
    agentId: "ed",
    state: "ready",
    contextPercent: 34,
    waitingMessages: 0,
    ...overrides,
  };
}

/** A request the stubbed endpoint received. */
export interface EndpointCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  /** The fields of a form body as text; empty for a read. */
  readonly fields: Readonly<Record<string, string>>;
}

function formFields(body: unknown): Record<string, string> {
  if (!(body instanceof FormData)) return {};
  return Object.fromEntries(
    [...body.entries()].map(([name, value]) => [name, String(value)]),
  );
}

/**
 * Replaces `fetch` by the endpoint of the chat sessions; every call is
 * recorded and answered with what `answer` returns. Undo with
 * `vi.unstubAllGlobals()`.
 */
export function stubSessionEndpoint(
  answer: (
    call: EndpointCall,
  ) => AgentChatSessionResponse | Promise<AgentChatSessionResponse> | Response,
): { readonly calls: EndpointCall[] } {
  const calls: EndpointCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (
      input: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const call: EndpointCall = {
        url: String(input),
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        fields: formFields(init.body),
      };
      calls.push(call);
      const answered = await answer(call);
      return answered instanceof Response ? answered : Response.json(answered);
    },
  );
  return { calls };
}

/** A promise a test settles itself, to hold a request open. */
export function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
