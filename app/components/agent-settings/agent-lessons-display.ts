import { isRecord } from "./agent-dreaming-wire";

import type { AgentLessonsRequest } from "./agent-lessons-api";
import type { DreamBadgeTone } from "./agent-dreaming-widgets";
import type { AgentRecipeView } from "@/definition/AgentDreaming";
import type { TFunction } from "i18next";

/** Whether a row belongs to a lesson or to a recipe. */
export type AgentRowKind = "lesson" | "recipe";

/** Why or whether a recipe is on, as the badge in the list words it. */
export type RecipeStatus = "active" | "failed" | "manual" | "off";

/** The color of the badge of each status, by semantic token. */
export const RECIPE_STATUS_TONES: Readonly<
  Record<RecipeStatus, DreamBadgeTone>
> = {
  active: "success",
  failed: "destructive",
  manual: "neutral",
  off: "neutral",
};

/**
 * The key of a change while it runs, so that the entry it concerns can show a
 * spinner.
 *
 * @param intent - What the change does.
 * @param id - The ID of the lesson or recipe it concerns.
 */
export function lessonsPendingKey(
  intent: AgentLessonsRequest["intent"],
  id: string,
): string {
  return `${intent}:${id}`;
}

/**
 * The key of a request while it runs.
 *
 * @param request - The change.
 */
export function lessonsRequestKey(request: AgentLessonsRequest): string {
  if (request.intent === "save-recipe")
    return lessonsPendingKey(request.intent, request.recipe.recipeId);
  if ("recipeId" in request)
    return lessonsPendingKey(request.intent, request.recipeId);
  return lessonsPendingKey(request.intent, request.lessonId);
}

/**
 * Which action of one lesson or recipe runs now, for its spinner.
 *
 * @param pendingKey - The key of the change that runs; `null` while idle.
 * @param kind - Whether the row is a lesson or a recipe.
 * @param id - The ID of the lesson or recipe.
 */
export function readPendingRowAction(
  pendingKey: string | null,
  kind: AgentRowKind,
  id: string,
): "toggle" | "remove" | null {
  if (pendingKey === lessonsPendingKey(`set-${kind}-active` as const, id))
    return "toggle";
  if (pendingKey === lessonsPendingKey(`remove-${kind}` as const, id))
    return "remove";
  return null;
}

/**
 * Whether a recipe is on, or why it is off: its failures or a switch by hand.
 *
 * @param recipe - The recipe.
 */
export function readRecipeStatus(recipe: AgentRecipeView): RecipeStatus {
  if (recipe.isActive) return "active";
  if (recipe.disabledReason === "failed") return "failed";
  if (recipe.disabledReason === "manual") return "manual";
  return "off";
}

/**
 * How often a recipe was used and when last: "12× genutzt, zuletzt 13.11.2026 17:05".
 *
 * @param recipe - The recipe.
 * @param formatDateTime - Writes a time the way the visitor chose.
 * @param t - The translation function.
 */
export function describeRecipeUsage(
  recipe: AgentRecipeView,
  formatDateTime: (value: string | null) => string,
  t: TFunction,
): string {
  if (recipe.useCount === 0) return t("agentLessons.recipes.usageNever");
  if (recipe.lastUsedAt === null)
    return t("agentLessons.recipes.usageNoDate", { uses: recipe.useCount });
  return t("agentLessons.recipes.usage", {
    uses: recipe.useCount,
    last: formatDateTime(recipe.lastUsedAt),
  });
}

/**
 * The input of a step as indented JSON, the way the editor shows it.
 *
 * @param input - The input of the step.
 */
export function formatStepInput(
  input: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(input, null, 2);
}

/**
 * The JSON object a text spells.
 *
 * @param text - The text of an input; a blank one stands for an empty object.
 * @returns The object, or `null` when the text is no JSON object.
 */
export function readJsonObject(text: string): Record<string, unknown> | null {
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The words of a comma-separated entry, without blanks and repeats.
 *
 * @param text - The entry.
 */
export function parseKeywords(text: string): string[] {
  const words = text
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
  return [...new Set(words)];
}

/**
 * A text cut to a length for a label, with an ellipsis where it was cut.
 *
 * @param text - The text.
 * @param limit - The most characters to keep.
 */
export function shortenText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}
