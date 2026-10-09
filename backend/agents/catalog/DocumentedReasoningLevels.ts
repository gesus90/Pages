/** Levels and default copied unchanged from one row of an official table. */
export interface DocumentedReasoningLevels {
  readonly efforts: readonly string[];
  readonly defaultEffort: string | null;
}

/**
 * OpenRouter's gateway effort values, highest first.
 *
 * @remarks
 * Source: OpenRouter API reference, schema `ReasoningEffort`, and
 * `ModelReasoning.supported_efforts`: "Null means no allowlist — all gateway
 * effort values are accepted"
 * (https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties,
 * retrieved 2026-10-09).
 */
export const OPENROUTER_GATEWAY_EFFORTS: readonly string[] = [
  "max",
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
];

/**
 * Efforts OpenRouter converts into a reasoning token budget, highest first.
 *
 * @remarks
 * Source: "For models that only support `reasoning.max_tokens`, the effort
 * level will be set based on the percentages above" (max and xhigh 95 %,
 * high 80 %, medium 50 %, low 20 %, minimal 10 % of `max_tokens`;
 * https://openrouter.ai/docs/guides/best-practices/reasoning-tokens,
 * retrieved 2026-10-09).
 */
export const OPENROUTER_BUDGET_EFFORTS: readonly string[] = [
  "max",
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
];

// Rows of the table "Controlling thinking" on
// https://ai.google.dev/gemini-api/docs/thinking ("Last updated 2026-09-25 UTC",
// retrieved 2026-10-09). Only rows that state a default level are kept: the
// generateContent reference accepts `thinkingLevel` from Gemini 3 on, and the
// Gemini 2.5 rows name no default level because those models think by budget.
const GOOGLE_THINKING_LEVELS: Readonly<
  Record<string, DocumentedReasoningLevels>
> = {
  "gemini-3.8-flash": {
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
  },
  "gemini-3.7-flash": {
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
  },
  "gemini-3.6-flash": {
    efforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "medium",
  },
  "gemini-3.5-flash-lite": {
    efforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "minimal",
  },
  "gemini-3.5-flash": {
    efforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "medium",
  },
  "gemini-3.1-pro-preview": {
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
  },
  "gemini-3.1-flash-lite-image": {
    efforts: ["minimal", "high"],
    defaultEffort: "minimal",
  },
  "gemini-3-flash-preview": {
    efforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "high",
  },
  "gemini-3-pro-preview": {
    efforts: ["low", "high"],
    defaultEffort: "high",
  },
  "gemini-robotics-er-2-preview": {
    efforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "high",
  },
};

/**
 * Returns the thinking levels Google documents for exactly this model.
 *
 * @param modelId - The catalog ID without the `models/` prefix.
 * @returns The documented levels, or `null` for every model the table does
 * not name, including aliases such as `gemini-flash-latest`.
 */
export function documentedGoogleThinkingLevels(
  modelId: string,
): DocumentedReasoningLevels | null {
  return Object.hasOwn(GOOGLE_THINKING_LEVELS, modelId)
    ? GOOGLE_THINKING_LEVELS[modelId]
    : null;
}
