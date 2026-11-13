import { backendRequestHeaders } from "@/app/lib/backend-request";

import type {
  AgentDreamFileSize,
  AgentDreamingFailure,
} from "@/definition/AgentDreaming";

/** The answer of an endpoint that refused a request or could not be read. */
export interface DreamingEndpointFailure {
  readonly ok: false;
  readonly error: AgentDreamingFailure;
}

/** Checks that an answer is of the shape the endpoint promises. */
export type DreamingAnswerGuard<Answer> = (value: unknown) => value is Answer;

const FAILURES: readonly AgentDreamingFailure[] = [
  "forbidden",
  "notFound",
  "invalidInput",
  "conflict",
  "unavailable",
];

const STATUS_FAILURES: Readonly<Partial<Record<number, AgentDreamingFailure>>> =
  { 400: "invalidInput", 403: "forbidden", 404: "notFound", 409: "conflict" };

/**
 * Whether a value is an object whose fields can be looked at.
 *
 * @param value - The value to check.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Whether every named field is a string.
 *
 * @param record - The object to check.
 * @param keys - The names of the fields.
 */
export function hasStrings(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => typeof record[key] === "string");
}

/**
 * Whether every named field is a number.
 *
 * @param record - The object to check.
 * @param keys - The names of the fields.
 */
export function hasNumbers(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => typeof record[key] === "number");
}

/**
 * Whether every named field is a boolean.
 *
 * @param record - The object to check.
 * @param keys - The names of the fields.
 */
export function hasBooleans(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => typeof record[key] === "boolean");
}

/**
 * Whether a value is a string or `null`.
 *
 * @param value - The value to check.
 */
export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Whether a value is a list whose every item passes a check.
 *
 * @param value - The value to check.
 * @param isItem - The check of one item.
 */
export function isList<Item>(
  value: unknown,
  isItem: DreamingAnswerGuard<Item>,
): value is Item[] {
  return Array.isArray(value) && value.every(isItem);
}

/**
 * Whether a value names how many characters a file uses and how many it may.
 *
 * @param value - The value to check.
 */
export function isFileSize(value: unknown): value is AgentDreamFileSize {
  return isRecord(value) && hasNumbers(value, ["characters", "limit"]);
}

/**
 * Whether a value is the refusal of an endpoint with a known reason.
 *
 * @param value - The answer to check.
 */
export function isFailureAnswer(value: Record<string, unknown>): boolean {
  return value.ok === false && FAILURES.some((error) => error === value.error);
}

/** The answer of the endpoint, or the failure its status code stands for. */
async function readAnswer<Answer>(
  response: Response,
  isAnswer: DreamingAnswerGuard<Answer>,
): Promise<Answer | DreamingEndpointFailure> {
  const body: unknown = await response.json().catch(() => null);
  if (isAnswer(body)) return body;
  return {
    ok: false,
    error: STATUS_FAILURES[response.status] ?? "unavailable",
  };
}

/**
 * Reads the overview of one agent from an endpoint.
 *
 * @param endpoint - The endpoint to ask.
 * @param agentId - The ID of the agent.
 * @param signal - Cancels the request when the view goes away.
 * @param isAnswer - Checks the shape of the answer.
 * @returns The answer, or why the server refused it.
 */
export async function readDreamingEndpoint<Answer>(
  endpoint: string,
  agentId: string,
  signal: AbortSignal,
  isAnswer: DreamingAnswerGuard<Answer>,
): Promise<Answer | DreamingEndpointFailure> {
  const query = new URLSearchParams({ agentId });
  const response = await fetch(`${endpoint}?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    signal,
  });
  return readAnswer(response, isAnswer);
}

/**
 * Sends a change to an endpoint as a form.
 *
 * @param endpoint - The endpoint to send to.
 * @param form - The fields of the change, with its intent.
 * @param isAnswer - Checks the shape of the answer.
 * @returns The answer, or why the server refused the change.
 */
export async function postDreamingEndpoint<Answer>(
  endpoint: string,
  form: FormData,
  isAnswer: DreamingAnswerGuard<Answer>,
): Promise<Answer | DreamingEndpointFailure> {
  const response = await fetch(endpoint, {
    body: form,
    cache: "no-store",
    credentials: "same-origin",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    method: "POST",
  });
  return readAnswer(response, isAnswer);
}
