import { backendRequestHeaders } from "@/app/lib/backend-request";
import { AGENT_CHAT_SESSION_ENDPOINT } from "@/definition/AgentChatSession";

import type {
  AgentChatSessionAction,
  AgentChatSessionFailure,
  AgentChatSessionOverview,
  AgentChatSessionResponse,
  AgentChatSessionSettings,
  AgentChatSessionState,
  AgentChatSessionView,
} from "@/definition/AgentChatSession";

/** What the endpoint of the chat sessions is asked to change. */
export type AgentSessionRequest =
  | {
      readonly intent: AgentChatSessionAction;
      readonly agentId: string;
      readonly sessionId: string;
    }
  | {
      readonly intent: "save-settings";
      readonly agentId: string;
      readonly settings: AgentChatSessionSettings;
    };

const STATES: readonly AgentChatSessionState[] = [
  "working",
  "ready",
  "resting",
  "restart_needed",
];

const FAILURES: readonly AgentChatSessionFailure[] = [
  "forbidden",
  "notFound",
  "invalidInput",
  "unavailable",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isSessionChat(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === "direct" || value.kind === "group") &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.isConfidential === "boolean"
  );
}

function isSession(value: unknown): value is AgentChatSessionView {
  if (!isRecord(value)) return false;
  const hasIdentity =
    typeof value.sessionId === "string" && typeof value.agentId === "string";
  const hasState =
    STATES.some((state) => state === value.state) &&
    isNumberOrNull(value.contextPercent) &&
    typeof value.waitingMessages === "number";
  const hasUsage =
    typeof value.tokens === "number" &&
    (value.lastActivityAt === null || typeof value.lastActivityAt === "string");
  return hasIdentity && hasState && hasUsage && isSessionChat(value.chat);
}

function isSettings(value: unknown): value is AgentChatSessionSettings {
  return (
    isRecord(value) &&
    typeof value.idleMinutes === "number" &&
    typeof value.restartPercent === "number"
  );
}

function isOverview(value: unknown): value is AgentChatSessionOverview {
  if (!isRecord(value)) return false;
  const hasCounts =
    typeof value.openSessions === "number" &&
    typeof value.restingSessions === "number" &&
    typeof value.tokensToday === "number";
  return (
    hasCounts &&
    typeof value.agentId === "string" &&
    typeof value.agentName === "string" &&
    typeof value.canChangeSettings === "boolean" &&
    isSettings(value.settings) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isSession)
  );
}

function isFailure(value: unknown): value is AgentChatSessionFailure {
  return FAILURES.some((failure) => failure === value);
}

/** Narrows an answer of the endpoint of the chat sessions. */
function isSessionResponse(value: unknown): value is AgentChatSessionResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return isOverview(value.overview);
  return value.ok === false && isFailure(value.error);
}

const STATUS_FAILURES: Readonly<
  Partial<Record<number, AgentChatSessionFailure>>
> = {
  400: "invalidInput",
  403: "forbidden",
  404: "notFound",
};

/** The answer of the endpoint, or the failure its status code stands for. */
async function readSessionResponse(
  response: Response,
): Promise<AgentChatSessionResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (isSessionResponse(body)) return body;
  return {
    ok: false,
    error: STATUS_FAILURES[response.status] ?? "unavailable",
  };
}

/**
 * Reads the chat sessions of one agent.
 *
 * @param agentId - The ID of the agent.
 * @param signal - Cancels the request when the view goes away.
 * @returns The overview, or why the server refused it.
 */
export async function readAgentSessionOverview(
  agentId: string,
  signal: AbortSignal,
): Promise<AgentChatSessionResponse> {
  const query = new URLSearchParams({ agentId });
  const response = await fetch(
    `${AGENT_CHAT_SESSION_ENDPOINT}?${query.toString()}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: backendRequestHeaders({ Accept: "application/json" }),
      signal,
    },
  );
  return readSessionResponse(response);
}

function requestForm(request: AgentSessionRequest): FormData {
  const formData = new FormData();
  formData.set("intent", request.intent);
  formData.set("agentId", request.agentId);
  if (request.intent === "save-settings") {
    formData.set("idleMinutes", String(request.settings.idleMinutes));
    formData.set("restartPercent", String(request.settings.restartPercent));
  } else {
    formData.set("sessionId", request.sessionId);
  }
  return formData;
}

/**
 * Stops, summarizes or restarts one chat session, or saves the settings of
 * the agent.
 *
 * @param request - What to change.
 * @returns The fresh overview, or why the server refused the change.
 */
export async function sendAgentSessionRequest(
  request: AgentSessionRequest,
): Promise<AgentChatSessionResponse> {
  const response = await fetch(AGENT_CHAT_SESSION_ENDPOINT, {
    body: requestForm(request),
    cache: "no-store",
    credentials: "same-origin",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    method: "POST",
  });
  return readSessionResponse(response);
}
