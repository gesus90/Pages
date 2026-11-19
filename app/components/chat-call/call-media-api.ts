import { backendRequestHeaders } from "@/app/lib/backend-request";
import {
  CHAT_CALL_MEDIA_ENDPOINT,
  isChatCallIceConfiguration,
  isChatCallSignalBatch,
} from "@/definition/ChatCall";

import type {
  ChatCallIceConfiguration,
  ChatCallSignal,
  ChatCallSignalBatch,
} from "@/definition/ChatCall";

/** Raised when the server no longer knows the call as running, because it ended. */
export class CallEndedError extends Error {
  public constructor() {
    super("The call is over.");
    this.name = "CallEndedError";
  }
}

function checkAnswer(response: Response): void {
  if (response.ok) return;
  // 404 is a call that ended or is not ours; 400 a call that does not run.
  if (response.status === 404 || response.status === 400)
    throw new CallEndedError();
  throw new Error(`The call media request failed with ${response.status}.`);
}

async function post(body: object): Promise<Response> {
  const response = await fetch(CHAT_CALL_MEDIA_ENDPOINT, {
    method: "POST",
    headers: backendRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  checkAnswer(response);
  return response;
}

/**
 * Asks the server for the STUN and TURN servers of a running call.
 * @param callId - The call; only its two members receive credentials.
 * @throws {CallEndedError} When the call no longer runs.
 */
export async function fetchIceConfiguration(
  callId: string,
): Promise<ChatCallIceConfiguration> {
  const response = await post({ intent: "ice", callId });
  const payload: unknown = await response.json();
  if (!isChatCallIceConfiguration(payload))
    throw new Error("The ICE servers of the call are invalid.");
  return payload;
}

/**
 * Passes an offer, an answer or a candidate on to the other member of the call.
 * @param callId - The call.
 * @param signal - What the browser tells the other one.
 * @throws {CallEndedError} When the call no longer runs.
 */
export async function sendCallSignal(
  callId: string,
  signal: ChatCallSignal,
): Promise<void> {
  await post({ intent: "signal", callId, signal });
}

/**
 * Reads what the other member of the call sent; the server holds the request
 * for news for about twenty seconds.
 * @param callId - The call.
 * @param options - The last sequence seen and the signal that drops the request.
 * @throws {CallEndedError} When the call no longer runs.
 */
export async function readCallSignals(
  callId: string,
  options: { readonly after: number; readonly signal: AbortSignal },
): Promise<ChatCallSignalBatch> {
  const query = new URLSearchParams({
    callId,
    after: String(options.after),
  });
  const response = await fetch(`${CHAT_CALL_MEDIA_ENDPOINT}?${query}`, {
    headers: backendRequestHeaders({ Accept: "application/json" }),
    signal: options.signal,
  });
  checkAnswer(response);
  const payload: unknown = await response.json();
  if (!isChatCallSignalBatch(payload))
    throw new Error("The call signals are invalid.");
  return payload;
}
