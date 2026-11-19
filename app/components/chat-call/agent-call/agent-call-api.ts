import { AGENT_CALL_ENDPOINT } from "@/definition/AgentCall";

import type {
  AgentCallEvent,
  AgentCallReadiness,
  AgentCallSpokenReport,
} from "@/definition/AgentCall";

/** The request of one utterance. */
export interface AgentTurnRequest {
  readonly agentId: string;
  readonly callId: string;
  readonly turn: number;
  readonly audio: Blob;
  /** Closing it interrupts the answer on the server. */
  readonly signal: AbortSignal;
  readonly onEvent: (event: AgentCallEvent) => void;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvent(value: unknown): value is AgentCallEvent {
  return isRecord(value) && typeof value.type === "string";
}

/**
 * Asks what a call with an agent needs.
 * @param agentId - The agent to call.
 * @returns The state of recognition, speech output and voice; `null` when the
 * server could not answer.
 */
export async function fetchAgentCallReadiness(
  agentId: string,
): Promise<AgentCallReadiness | null> {
  try {
    const response = await fetch(
      `${AGENT_CALL_ENDPOINT}?agentId=${encodeURIComponent(agentId)}`,
      { credentials: "same-origin" },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.readiness)) return null;
    const { recognition, synthesis, isVoiceMissing } = body.readiness;
    if (
      (recognition !== "ready" && recognition !== "not_configured") ||
      (synthesis !== "ready" && synthesis !== "not_configured") ||
      typeof isVoiceMissing !== "boolean"
    )
      return null;
    return { recognition, synthesis, isVoiceMissing };
  } catch (error: unknown) {
    console.warn("Pages could not read the state of the call.", error);
    return null;
  }
}

/**
 * Sends one utterance and reads the events of its answer as they arrive.
 * @param request - Agent, call, running number, recording and the listener.
 * @remarks
 * The answer is a stream of lines of JSON; each line reaches `onEvent` as soon
 * as it is complete. An aborted request ends quietly; any other failure ends
 * with a `failed` event.
 */
export async function streamAgentTurn(
  request: AgentTurnRequest,
): Promise<void> {
  const query = new URLSearchParams({
    agentId: request.agentId,
    callId: request.callId,
    turn: String(request.turn),
  });
  try {
    const response = await fetch(`${AGENT_CALL_ENDPOINT}?${query.toString()}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "audio/wav" },
      body: request.audio,
      signal: request.signal,
    });
    if (!response.ok || response.body === null) {
      request.onEvent({ type: "failed", code: "agent_unavailable" });
      return;
    }
    await readLines(response.body, request.onEvent);
  } catch (error: unknown) {
    if (request.signal.aborted) return;
    console.warn("Pages lost the answer of the call.", error);
    request.onEvent({ type: "failed", code: "agent_unavailable" });
  }
}

async function readLines(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentCallEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    pending += decoder.decode(chunk.value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const parsed: unknown = JSON.parse(line);
      if (isEvent(parsed)) onEvent(parsed);
    }
  }
}

/**
 * Tells the server how much of an interrupted answer the person heard, so the
 * stored text shows where the speech ended.
 * @param report - Agent, call, turn and the characters played.
 */
export async function reportSpokenAnswer(
  report: AgentCallSpokenReport,
): Promise<void> {
  try {
    await fetch(AGENT_CALL_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "spoken", ...report }),
      // The page may close right after hanging up.
      keepalive: true,
    });
  } catch (error: unknown) {
    console.warn("Pages could not report the interrupted answer.", error);
  }
}
