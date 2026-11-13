import {
  AGENT_DREAMING_ENDPOINT,
  AGENT_DREAM_INTERVAL_UNITS,
} from "@/definition/AgentDreaming";

import {
  hasBooleans,
  hasNumbers,
  hasStrings,
  isFailureAnswer,
  isFileSize,
  isList,
  isNullableString,
  isRecord,
  postDreamingEndpoint,
  readDreamingEndpoint,
} from "./agent-dreaming-wire";
import { DREAM_LOG_KINDS } from "./agent-dreaming-display";

import type {
  AgentDreamCounts,
  AgentDreamLogEntry,
  AgentDreamModelChoice,
  AgentDreamRunStatus,
  AgentDreamRunView,
  AgentDreamSchedule,
  AgentDreamTrigger,
  AgentDreamingOverview,
  AgentDreamingResponse,
} from "@/definition/AgentDreaming";

/** The model a dream run is pinned to; `null` stands for the agent's own model. */
export type AgentDreamModelRef = NonNullable<AgentDreamingOverview["model"]>;

/** The schedule and the model of the dream run, as the card "Zeitplan" saves them. */
export interface AgentDreamSettings {
  readonly schedule: AgentDreamSchedule;
  readonly model: AgentDreamModelRef | null;
}

/** What the endpoint of Dreaming is asked to do. */
export type AgentDreamingRequest =
  | {
      readonly intent: "save-settings";
      readonly agentId: string;
      readonly settings: AgentDreamSettings;
    }
  | { readonly intent: "run-now"; readonly agentId: string };

const STATUSES: readonly AgentDreamRunStatus[] = [
  "updated",
  "unchanged",
  "failed",
];

const TRIGGERS: readonly AgentDreamTrigger[] = [
  "schedule",
  "manual",
  "logbook",
];

function isLogEntry(value: unknown): value is AgentDreamLogEntry {
  return (
    isRecord(value) &&
    DREAM_LOG_KINDS.some((kind) => kind === value.kind) &&
    typeof value.text === "string"
  );
}

function isCounts(value: unknown): value is AgentDreamCounts {
  return isRecord(value) && hasNumbers(value, DREAM_LOG_KINDS);
}

function isRun(value: unknown): value is AgentDreamRunView {
  if (!isRecord(value)) return false;
  return (
    typeof value.at === "string" &&
    STATUSES.some((status) => status === value.status) &&
    (value.trigger === null ||
      TRIGGERS.some((trigger) => trigger === value.trigger)) &&
    isNullableString(value.errorCode) &&
    isCounts(value.counts) &&
    isList(value.log, isLogEntry)
  );
}

function isSchedule(value: unknown): value is AgentDreamSchedule {
  if (!isRecord(value)) return false;
  return (
    hasBooleans(value, ["isEnabled", "isOnFullLogbook"]) &&
    typeof value.interval === "number" &&
    AGENT_DREAM_INTERVAL_UNITS.some((unit) => unit === value.unit) &&
    isNullableString(value.time) &&
    (value.weekday === null || typeof value.weekday === "number")
  );
}

function isModelRef(value: unknown): value is AgentDreamModelRef {
  return isRecord(value) && hasStrings(value, ["connectionId", "model"]);
}

function isModelChoice(value: unknown): value is AgentDreamModelChoice {
  return (
    isRecord(value) && hasStrings(value, ["connectionId", "model", "label"])
  );
}

function isLogbookFill(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasNumbers(value, ["count", "fillPercent", "triggerPercent"])
  );
}

function isDreamSize(value: unknown): boolean {
  return (
    isFileSize(value) && isRecord(value) && typeof value.lessons === "number"
  );
}

function isFiles(value: unknown): boolean {
  return isRecord(value) && hasStrings(value, ["memory", "dream"]);
}

function isOverviewHead(value: Record<string, unknown>): boolean {
  return (
    hasStrings(value, ["agentId", "agentName", "instanceTime"]) &&
    hasBooleans(value, ["isRunning", "isWaiting", "canChange"]) &&
    isSchedule(value.schedule) &&
    (value.model === null || isModelRef(value.model)) &&
    isNullableString(value.ownModelLabel) &&
    isNullableString(value.nextRunAt)
  );
}

function isOverviewBody(value: Record<string, unknown>): boolean {
  return (
    isList(value.models, isModelChoice) &&
    (value.lastRun === null || isRun(value.lastRun)) &&
    isFileSize(value.memory) &&
    isDreamSize(value.dream) &&
    isLogbookFill(value.logbook) &&
    (value.files === null || isFiles(value.files))
  );
}

function isOverview(value: unknown): value is AgentDreamingOverview {
  return isRecord(value) && isOverviewHead(value) && isOverviewBody(value);
}

function isDreamingResponse(value: unknown): value is AgentDreamingResponse {
  if (!isRecord(value)) return false;
  if (value.ok !== true) return isFailureAnswer(value);
  return (
    isOverview(value.overview) &&
    (value.run === undefined ||
      value.run === "started" ||
      value.run === "waiting")
  );
}

/**
 * Reads the Dreaming of one agent.
 *
 * @param agentId - The ID of the agent.
 * @param signal - Cancels the request when the view goes away.
 * @returns The overview, or why the server refused it.
 */
export async function readAgentDreamingOverview(
  agentId: string,
  signal: AbortSignal,
): Promise<AgentDreamingResponse> {
  return readDreamingEndpoint(
    AGENT_DREAMING_ENDPOINT,
    agentId,
    signal,
    isDreamingResponse,
  );
}

function appendSettings(form: FormData, settings: AgentDreamSettings): void {
  const { schedule, model } = settings;
  form.set("enabled", String(schedule.isEnabled));
  form.set("interval", String(schedule.interval));
  form.set("unit", schedule.unit);
  form.set("time", schedule.time ?? "");
  form.set(
    "weekday",
    schedule.weekday === null ? "" : String(schedule.weekday),
  );
  form.set("onFullLogbook", String(schedule.isOnFullLogbook));
  form.set("modelConnectionId", model?.connectionId ?? "");
  form.set("model", model?.model ?? "");
}

function requestForm(request: AgentDreamingRequest): FormData {
  const form = new FormData();
  form.set("intent", request.intent);
  form.set("agentId", request.agentId);
  if (request.intent === "save-settings")
    appendSettings(form, request.settings);
  return form;
}

/**
 * Saves the schedule of an agent, or starts a dream run at once.
 *
 * @param request - What to do.
 * @returns The fresh overview, or why the server refused the change.
 */
export async function sendAgentDreamingRequest(
  request: AgentDreamingRequest,
): Promise<AgentDreamingResponse> {
  return postDreamingEndpoint(
    AGENT_DREAMING_ENDPOINT,
    requestForm(request),
    isDreamingResponse,
  );
}
