import { backendRequestHeaders } from "@/app/lib/backend-request";
import { AGENT_CHAT_CONTROL_ENDPOINT } from "@/definition/AgentChatControl";

import type {
  AgentChatControlFailure,
  AgentChatControlResponse,
  AgentChatControlTarget,
} from "@/definition/AgentChatControl";

const FAILURES: readonly AgentChatControlFailure[] = [
  "forbidden",
  "notFound",
  "invalidInput",
  "unavailable",
  "modelNotAllowed",
];

const STATUS_FAILURES: Readonly<
  Partial<Record<number, AgentChatControlFailure>>
> = {
  400: "invalidInput",
  403: "forbidden",
  404: "notFound",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Narrows an answer of the control endpoint; the server is the only source,
 * so a known shape of `ok` and `error` is enough.
 */
function isControlResponse(value: unknown): value is AgentChatControlResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return true;
  return (
    value.ok === false && FAILURES.some((failure) => failure === value.error)
  );
}

/**
 * The fields that name the chat of an agent in a request.
 *
 * @param target - The chat and its agent.
 */
export function targetFields(
  target: AgentChatControlTarget,
): Record<string, string> {
  return {
    kind: target.kind,
    agentId: target.agentId,
    ...(target.conversationId === undefined
      ? {}
      : { conversationId: target.conversationId }),
  };
}

/**
 * Sends one request to the control of agents in a chat (PAGE-380).
 *
 * @param fields - The intent and its fields.
 * @returns The answer, or the failure its status code stands for.
 */
export async function sendAgentControl(
  fields: Readonly<Record<string, string>>,
): Promise<AgentChatControlResponse> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const response = await fetch(AGENT_CHAT_CONTROL_ENDPOINT, {
    body,
    cache: "no-store",
    credentials: "same-origin",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    method: "POST",
  });
  const answer: unknown = await response.json().catch(() => null);
  if (isControlResponse(answer)) return answer;
  return {
    ok: false,
    error: STATUS_FAILURES[response.status] ?? "unavailable",
  };
}
