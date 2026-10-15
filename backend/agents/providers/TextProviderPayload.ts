import { readAgentObject } from "@/backend/agents/AgentPayload";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { ticketAssetPayload } from "./TicketAssetPayload";
import { geminiThinkingLevel } from "./GoogleAiStudioProvider";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";
import type { ApiProviderId } from "@/definition/AgentConnection";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";

/** A provider request: the path below the fixed endpoint and the JSON body. */
interface TextProviderRequest {
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
}

const MAXIMUM_OUTPUT_TOKENS = 16_384;

/** Anthropic's server-side search tool; Pages defines no client tools. */
const ANTHROPIC_WEB_SEARCH = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
} as const;

/** Content blocks of an Anthropic answer that belong to its own search. */
const ANTHROPIC_SEARCH_BLOCKS: ReadonlySet<unknown> = new Set([
  "server_tool_use",
  "web_search_tool_result",
]);

/** Output items of an OpenAI response that belong to reasoning or search. */
const OPENAI_SEARCH_ITEMS: ReadonlySet<unknown> = new Set([
  "reasoning",
  "web_search_call",
]);

function googleRequest(
  input: TextExecutionInput,
  assets: readonly AgentTicketAssetContent[],
): TextProviderRequest {
  const { model, reasoningEffort } = input.agent;
  return {
    path: `/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`,
    body: {
      ...(input.instructions === undefined
        ? {}
        : { systemInstruction: { parts: [{ text: input.instructions }] } }),
      contents: [{ parts: ticketAssetPayload("google", input.prompt, assets) }],
      ...(input.webSearch === true ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        maxOutputTokens: MAXIMUM_OUTPUT_TOKENS,
        ...(reasoningEffort === null
          ? {}
          : {
              thinkingConfig: {
                thinkingLevel: geminiThinkingLevel(reasoningEffort),
              },
            }),
      },
    },
  };
}

function anthropicRequest(
  input: TextExecutionInput,
  assets: readonly AgentTicketAssetContent[],
): TextProviderRequest {
  const { model, reasoningEffort } = input.agent;
  return {
    path: "/messages",
    body: {
      model,
      max_tokens: MAXIMUM_OUTPUT_TOKENS,
      ...(input.instructions === undefined
        ? {}
        : { system: input.instructions }),
      messages: [
        {
          role: "user",
          content: assets.length
            ? ticketAssetPayload("anthropic", input.prompt, assets)
            : input.prompt,
        },
      ],
      ...(input.webSearch === true ? { tools: [ANTHROPIC_WEB_SEARCH] } : {}),
      ...(reasoningEffort === null
        ? {}
        : { output_config: { effort: reasoningEffort } }),
    },
  };
}

/** OpenAI offers its search only in the Responses API. */
function openAiSearchRequest(
  input: TextExecutionInput,
  assets: readonly AgentTicketAssetContent[],
): TextProviderRequest {
  const { model, reasoningEffort } = input.agent;
  return {
    path: "/responses",
    body: {
      model,
      ...(input.instructions === undefined
        ? {}
        : { instructions: input.instructions }),
      input: assets.length
        ? [
            {
              role: "user",
              content: ticketAssetPayload("responses", input.prompt, assets),
            },
          ]
        : input.prompt,
      tools: [{ type: "web_search" }],
      max_output_tokens: MAXIMUM_OUTPUT_TOKENS,
      store: false,
      ...(reasoningEffort === null
        ? {}
        : { reasoning: { effort: reasoningEffort } }),
    },
  };
}

function completionsRequest(
  provider: ApiProviderId,
  input: TextExecutionInput,
  assets: readonly AgentTicketAssetContent[] = [],
): TextProviderRequest {
  const { model, reasoningEffort } = input.agent;
  let reasoning: Readonly<Record<string, unknown>> = {};
  if (reasoningEffort !== null) {
    reasoning =
      provider === "openrouter"
        ? { reasoning: { effort: reasoningEffort } }
        : { reasoning_effort: reasoningEffort };
  }
  const user = {
    role: "user",
    content: assets.length
      ? ticketAssetPayload("completions", input.prompt, assets)
      : input.prompt,
  };
  return {
    path: "/chat/completions",
    body: {
      model,
      messages:
        input.instructions === undefined
          ? [user]
          : [{ role: "system", content: input.instructions }, user],
      stream: false,
      ...(provider === "openai"
        ? { max_completion_tokens: MAXIMUM_OUTPUT_TOKENS, store: false }
        : { max_tokens: MAXIMUM_OUTPUT_TOKENS }),
      ...(provider === "openrouter"
        ? { provider: { allow_fallbacks: false } }
        : {}),
      ...(provider === "openrouter" && input.webSearch === true
        ? { plugins: [{ id: "web" }] }
        : {}),
      ...reasoning,
    },
  };
}

/** Builds native text payloads from the same endpoint and effort contracts as A7. */
export function createTextProviderRequest(
  provider: ApiProviderId,
  input: TextExecutionInput,
  assets: readonly AgentTicketAssetContent[] = [],
): TextProviderRequest {
  if (provider === "google_ai_studio") return googleRequest(input, assets);
  if (provider === "anthropic") return anthropicRequest(input, assets);
  if (provider === "openai" && input.webSearch === true)
    return openAiSearchRequest(input, assets);
  return completionsRequest(provider, input, assets);
}

function readTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) throw new TextAssistantError("invalidOutput");
  return parts
    .map((part: unknown) => {
      const entry = readAgentObject(part);
      if (typeof entry.text !== "string" || entry.thought === true)
        throw new TextAssistantError("invalidOutput");
      return entry.text;
    })
    .join("");
}

/** Joins the text blocks of an answer that used Anthropic's search. */
function readAnthropicSearchText(content: unknown): string {
  if (!Array.isArray(content)) throw new TextAssistantError("invalidOutput");
  const texts: string[] = [];
  for (const block of content.map(readAgentObject)) {
    if (block.type === "text" && typeof block.text === "string")
      texts.push(block.text);
    else if (!ANTHROPIC_SEARCH_BLOCKS.has(block.type))
      throw new TextAssistantError("invalidOutput");
  }
  return texts.join("");
}

/** Reads a completed OpenAI response; refusals and unknown items are rejected. */
function readOpenAiSearchText(response: Record<string, unknown>): string {
  if (response.status !== "completed" || !Array.isArray(response.output))
    throw new TextAssistantError("invalidOutput");
  const texts: string[] = [];
  for (const item of response.output.map(readAgentObject)) {
    if (OPENAI_SEARCH_ITEMS.has(item.type)) continue;
    if (item.type !== "message" || !Array.isArray(item.content))
      throw new TextAssistantError("invalidOutput");
    for (const part of item.content.map(readAgentObject)) {
      if (part.type !== "output_text" || typeof part.text !== "string")
        throw new TextAssistantError("invalidOutput");
      texts.push(part.text);
    }
  }
  return texts.join("");
}

/** Rejects truncation, tool requests and refusal outputs instead of applying partial text. */
export function readTextProviderResponse(
  provider: ApiProviderId,
  payload: unknown,
  options: { readonly webSearch?: boolean } = {},
): string {
  const response = readAgentObject(payload);
  if (provider === "openai" && options.webSearch === true)
    return readOpenAiSearchText(response);
  if (provider === "anthropic") {
    if (response.stop_reason !== "end_turn")
      throw new TextAssistantError("invalidOutput");
    return options.webSearch === true
      ? readAnthropicSearchText(response.content)
      : readTextParts(response.content);
  }
  if (provider === "google_ai_studio") {
    const candidate = readAgentObject(
      Array.isArray(response.candidates) ? response.candidates[0] : null,
    );
    if (candidate.finishReason !== "STOP")
      throw new TextAssistantError("invalidOutput");
    return readTextParts(readAgentObject(candidate.content).parts);
  }
  const choice = readAgentObject(
    Array.isArray(response.choices) ? response.choices[0] : null,
  );
  const message = readAgentObject(choice.message);
  if (
    choice.finish_reason !== "stop" ||
    typeof message.content !== "string" ||
    message.tool_calls !== undefined ||
    message.refusal
  )
    throw new TextAssistantError("invalidOutput");
  return message.content;
}
