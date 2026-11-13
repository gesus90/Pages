import { backendRequestHeaders } from "@/app/lib/backend-request";
import {
  AGENT_LOGBOOK_ENDPOINT,
  AGENT_LOGBOOK_KINDS,
} from "@/definition/AgentLogbook";

import type {
  AgentLogbookEntryView,
  AgentLogbookFailure,
  AgentLogbookModelChoice,
  AgentLogbookOverview,
  AgentLogbookResponse,
  AgentLogbookSettings,
} from "@/definition/AgentLogbook";

/** What the endpoint of the Lagebuch is asked to change. */
export type AgentLogbookRequest =
  | {
      readonly intent: "save-settings";
      readonly agentId: string;
      readonly settings: AgentLogbookSettings;
    }
  | {
      readonly intent: "remove-entries";
      readonly agentId: string;
      readonly entryIds: readonly string[];
    };

const FAILURES: readonly AgentLogbookFailure[] = [
  "forbidden",
  "notFound",
  "invalidInput",
  "unavailable",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.kind === "direct" || value.kind === "group") &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  );
}

function isEntry(value: unknown): value is AgentLogbookEntryView {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    AGENT_LOGBOOK_KINDS.some((kind) => kind === value.kind) &&
    typeof value.text === "string" &&
    typeof value.topic === "string" &&
    typeof value.at === "string" &&
    isSource(value.source) &&
    isStringList(value.participants) &&
    (value.origin === "agent" || value.origin === "background")
  );
}

function isModelChoice(value: unknown): value is AgentLogbookModelChoice {
  return (
    isRecord(value) &&
    typeof value.connectionId === "string" &&
    typeof value.model === "string" &&
    typeof value.label === "string"
  );
}

function isSettings(value: unknown): value is AgentLogbookSettings {
  if (!isRecord(value)) return false;
  const { model } = value;
  const hasModel =
    model === null ||
    (isRecord(model) &&
      typeof model.connectionId === "string" &&
      typeof model.model === "string");
  return (
    typeof value.limit === "number" &&
    typeof value.quietMinutes === "number" &&
    hasModel
  );
}

function isOverview(value: unknown): value is AgentLogbookOverview {
  if (!isRecord(value)) return false;
  return (
    typeof value.agentId === "string" &&
    typeof value.agentName === "string" &&
    typeof value.count === "number" &&
    typeof value.fillPercent === "number" &&
    typeof value.canChangeSettings === "boolean" &&
    isSettings(value.settings) &&
    (value.instanceModel === null || isModelChoice(value.instanceModel)) &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry) &&
    Array.isArray(value.models) &&
    value.models.every(isModelChoice) &&
    Array.isArray(value.chats) &&
    value.chats.every(isSource)
  );
}

function isLogbookResponse(value: unknown): value is AgentLogbookResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return isOverview(value.overview);
  return value.ok === false && FAILURES.some((error) => error === value.error);
}

const STATUS_FAILURES: Readonly<Partial<Record<number, AgentLogbookFailure>>> =
  { 400: "invalidInput", 403: "forbidden", 404: "notFound" };

/** The answer of the endpoint, or the failure its status code stands for. */
async function readLogbookResponse(
  response: Response,
): Promise<AgentLogbookResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (isLogbookResponse(body)) return body;
  return {
    ok: false,
    error: STATUS_FAILURES[response.status] ?? "unavailable",
  };
}

/**
 * Reads the Lagebuch of one agent.
 *
 * @param agentId - The ID of the agent.
 * @param signal - Cancels the request when the view goes away.
 * @returns The overview, or why the server refused it.
 */
export async function readAgentLogbookOverview(
  agentId: string,
  signal: AbortSignal,
): Promise<AgentLogbookResponse> {
  const query = new URLSearchParams({ agentId });
  const response = await fetch(`${AGENT_LOGBOOK_ENDPOINT}?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    signal,
  });
  return readLogbookResponse(response);
}

function requestForm(request: AgentLogbookRequest): FormData {
  const formData = new FormData();
  formData.set("intent", request.intent);
  formData.set("agentId", request.agentId);
  if (request.intent === "save-settings") {
    formData.set("limit", String(request.settings.limit));
    formData.set("quietMinutes", String(request.settings.quietMinutes));
    formData.set("modelConnectionId", request.settings.model?.connectionId ?? "");
    formData.set("model", request.settings.model?.model ?? "");
  } else {
    for (const id of request.entryIds) formData.append("entryId", id);
  }
  return formData;
}

/**
 * Saves the settings of the Lagebuch of an agent, or removes entries.
 *
 * @param request - What to change.
 * @returns The fresh overview, or why the server refused the change.
 */
export async function sendAgentLogbookRequest(
  request: AgentLogbookRequest,
): Promise<AgentLogbookResponse> {
  const response = await fetch(AGENT_LOGBOOK_ENDPOINT, {
    body: requestForm(request),
    cache: "no-store",
    credentials: "same-origin",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    method: "POST",
  });
  return readLogbookResponse(response);
}
