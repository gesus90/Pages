import { z } from "zod";

import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logEvent } from "@/backend/logging/Logger";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";
import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";

/** The decisions endpoint of OpenRouter (PAGE-379); it is in alpha and not the chat endpoint. */
const OPENROUTER_DECISIONS_URL = `${AGENT_PROVIDERS.openrouter.endpoint.replace(/\/v1$/u, "/alpha")}/decisions`;

/** The most bytes of an answer Pages reads. */
const MAXIMUM_ANSWER_BYTES = 256 * 1024;

const COMPONENT = "OpenRouterDecisionsClient";

/** A yes/no question; its answer is the probability of yes. */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
}

/** A question with options; its answer is the probability of each option. */
export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  /** Each option with its description. */
  readonly criteria: Readonly<Record<string, string>>;
}

/** One typed question of a decision request. */
export type DecisionQuestion = NoulQuestion | ChoiceQuestion;

/** One decision request to OpenRouter. */
export interface OpenRouterDecisionsRequest {
  readonly apiKey: string;
  readonly model: string;
  /** What the questions are about; a JSON object with named fields. */
  readonly state: Readonly<Record<string, unknown>>;
  /** The questions, by an ID of the caller. */
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  /** Cancels the call; the time limit applies either way. */
  readonly signal?: AbortSignal;
}

/** The answer to a {@link NoulQuestion}. */
export interface NoulAnswer {
  readonly type: "noul";
  /** The probability of yes, 0 to 1. */
  readonly noul: number;
}

/** The answer to a {@link ChoiceQuestion}. */
export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  /** The probability of each option; absent when the model gave none. */
  readonly probabilities: Readonly<Record<string, number>> | null;
}

/** What OpenRouter answered, by the question IDs of the request. */
export interface OpenRouterDecisionsResponse {
  /** The model build that answered. */
  readonly model: string;
  readonly answers: Readonly<Record<string, NoulAnswer | ChoiceAnswer>>;
}

const PROBABILITY = z.number().min(0).max(1);

const RESPONSE = z.object({
  model: z.string().min(1).max(200),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("noul"), noul: PROBABILITY }),
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        probabilities: z.record(z.string(), PROBABILITY).optional(),
      }),
    ]),
  ),
});

function requestBody(request: OpenRouterDecisionsRequest): string {
  return JSON.stringify({
    model: request.model,
    state: request.state,
    questions: request.questions,
  });
}

async function readBody(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      bytes += chunk.value.byteLength;
      if (bytes > MAXIMUM_ANSWER_BYTES) return null;
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseResponse(text: string): OpenRouterDecisionsResponse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      throw new ConversationObserverError("decision_invalid");
    throw error;
  }
  const parsed = RESPONSE.safeParse(json);
  if (!parsed.success) throw new ConversationObserverError("decision_invalid");
  return {
    model: parsed.data.model,
    answers: Object.fromEntries(
      Object.entries(parsed.data.answers).map(([id, answer]) => [
        id,
        answer.type === "noul"
          ? answer
          : { ...answer, probabilities: answer.probabilities ?? null },
      ]),
    ),
  };
}

/**
 * Asks an OpenRouter decision model typed questions (PAGE-379).
 *
 * @remarks
 * `POST https://openrouter.ai/api/alpha/decisions` with `model`, `state` and
 * `questions`; a `noul` question answers with the probability of yes, a
 * `choice` question with a probability for each option
 * (https://openrouter.ai/docs/guides/community/multimodal-decisions). The key
 * travels only in the header, redirects are refused, and neither the state,
 * the key nor an error body is logged; only the HTTP status and the outcome
 * are. The transport is injected, so a test answers without a key and
 * without cost. No call is repeated.
 */
export class OpenRouterDecisionsClient {
  private readonly request: typeof fetch;

  public constructor(request: typeof fetch = fetch) {
    this.request = request;
  }

  /**
   * Asks once.
   *
   * @param input - Key, model, state, questions and the caller's cancellation.
   * @returns The model that answered and its typed answers.
   * @throws {ConversationObserverError} `decision_unreachable` when OpenRouter
   * cannot be reached or the time is up, `decision_failed` for an HTTP error,
   * `decision_invalid` for an answer that is no valid decision response.
   */
  public async decide(
    input: OpenRouterDecisionsRequest,
  ): Promise<OpenRouterDecisionsResponse> {
    const timeout = AbortSignal.timeout(
      CONVERSATION_DECISION_LIMITS.timeoutSeconds * 1000,
    );
    const signal =
      input.signal === undefined
        ? timeout
        : AbortSignal.any([input.signal, timeout]);
    const response = await this.send(input, signal);
    this.log(response.status);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConversationObserverError("decision_failed");
    }
    let text: string | null;
    try {
      text = await readBody(response);
    } catch {
      input.signal?.throwIfAborted();
      throw new ConversationObserverError("decision_unreachable");
    }
    if (text === null) throw new ConversationObserverError("decision_invalid");
    return parseResponse(text);
  }

  private async send(
    input: OpenRouterDecisionsRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.request(OPENROUTER_DECISIONS_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: requestBody(input),
        signal,
        redirect: "error",
      });
    } catch {
      input.signal?.throwIfAborted();
      this.log(null);
      throw new ConversationObserverError("decision_unreachable");
    }
  }

  private log(statusCode: number | null): void {
    const isOk = statusCode !== null && statusCode >= 200 && statusCode < 300;
    logEvent({
      level: isOk ? "debug" : "warn",
      event: "conversation.decision.response",
      component: COMPONENT,
      message: "The decision model provider answered",
      metadata: { provider: "openrouter", statusCode },
    });
  }
}
