import {
  AGENT_LESSONS_ENDPOINT,
  AGENT_RECIPE_KINDS,
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

import type {
  AgentLessonView,
  AgentLessonsOverview,
  AgentLessonsResponse,
  AgentRecipeParameter,
  AgentRecipeStep,
  AgentRecipeView,
} from "@/definition/AgentDreaming";

/** What a recipe is saved with; everything the editor changes. */
export interface AgentRecipeInput {
  readonly recipeId: string;
  readonly name: string;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly body: string;
  readonly parameters: readonly AgentRecipeParameter[];
  readonly steps: readonly AgentRecipeStep[];
}

/** What the endpoint of lessons and recipes is asked to change. */
export type AgentLessonsRequest =
  | {
      readonly intent: "save-lesson";
      readonly agentId: string;
      readonly lessonId: string;
      readonly text: string;
      readonly evidence: string;
    }
  | {
      readonly intent: "set-lesson-active";
      readonly agentId: string;
      readonly lessonId: string;
      readonly isActive: boolean;
    }
  | {
      readonly intent: "remove-lesson";
      readonly agentId: string;
      readonly lessonId: string;
    }
  | {
      readonly intent: "save-recipe";
      readonly agentId: string;
      readonly recipe: AgentRecipeInput;
    }
  | {
      readonly intent: "set-recipe-active";
      readonly agentId: string;
      readonly recipeId: string;
      readonly isActive: boolean;
    }
  | {
      readonly intent: "remove-recipe";
      readonly agentId: string;
      readonly recipeId: string;
    };

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isLesson(value: unknown): value is AgentLessonView {
  return (
    isRecord(value) &&
    hasStrings(value, ["id", "text", "evidence", "date"]) &&
    typeof value.strength === "number" &&
    typeof value.isActive === "boolean"
  );
}

function isParameter(value: unknown): value is AgentRecipeParameter {
  return isRecord(value) && hasStrings(value, ["name", "description"]);
}

function isStep(value: unknown): value is AgentRecipeStep {
  return (
    isRecord(value) &&
    typeof value.tool === "string" &&
    typeof value.note === "string" &&
    isRecord(value.input) &&
    !Array.isArray(value.input)
  );
}

function isRecipeState(value: Record<string, unknown>): boolean {
  return (
    hasNumbers(value, ["strength", "useCount", "failureStreak"]) &&
    hasBooleans(value, ["isActive"]) &&
    isNullableString(value.lastUsedAt) &&
    isNullableString(value.lastError) &&
    (value.disabledReason === null ||
      value.disabledReason === "failed" ||
      value.disabledReason === "manual") &&
    (value.origin === "dream" || value.origin === "manual")
  );
}

function isRecipe(value: unknown): value is AgentRecipeView {
  return (
    isRecord(value) &&
    hasStrings(value, ["id", "name", "summary", "body", "evidence", "date"]) &&
    AGENT_RECIPE_KINDS.some((kind) => kind === value.kind) &&
    isRecipeState(value) &&
    isList(value.keywords, isText) &&
    isList(value.parameters, isParameter) &&
    isList(value.steps, isStep)
  );
}

function isOverview(value: unknown): value is AgentLessonsOverview {
  return (
    isRecord(value) &&
    hasStrings(value, ["agentId", "agentName"]) &&
    hasBooleans(value, ["canChange"]) &&
    isFileSize(value.dream) &&
    isList(value.lessons, isLesson) &&
    isList(value.recipes, isRecipe)
  );
}

function isLessonsResponse(value: unknown): value is AgentLessonsResponse {
  if (!isRecord(value)) return false;
  if (value.ok !== true) return isFailureAnswer(value);
  return isOverview(value.overview);
}

/**
 * Reads the lessons and recipes of one agent.
 *
 * @param agentId - The ID of the agent.
 * @param signal - Cancels the request when the view goes away.
 * @returns The overview, or why the server refused it.
 */
export async function readAgentLessonsOverview(
  agentId: string,
  signal: AbortSignal,
): Promise<AgentLessonsResponse> {
  return readDreamingEndpoint(
    AGENT_LESSONS_ENDPOINT,
    agentId,
    signal,
    isLessonsResponse,
  );
}

function appendRecipe(form: FormData, recipe: AgentRecipeInput): void {
  form.set("recipeId", recipe.recipeId);
  form.set("name", recipe.name);
  form.set("summary", recipe.summary);
  form.set("keywords", recipe.keywords.join(", "));
  form.set("body", recipe.body);
  form.set("parameters", JSON.stringify(recipe.parameters));
  form.set("steps", JSON.stringify(recipe.steps));
}

function appendFields(form: FormData, request: AgentLessonsRequest): void {
  switch (request.intent) {
    case "save-lesson":
      form.set("lessonId", request.lessonId);
      form.set("text", request.text);
      form.set("evidence", request.evidence);
      break;
    case "set-lesson-active":
      form.set("lessonId", request.lessonId);
      form.set("active", String(request.isActive));
      break;
    case "remove-lesson":
      form.set("lessonId", request.lessonId);
      break;
    case "save-recipe":
      appendRecipe(form, request.recipe);
      break;
    case "set-recipe-active":
      form.set("recipeId", request.recipeId);
      form.set("active", String(request.isActive));
      break;
    case "remove-recipe":
      form.set("recipeId", request.recipeId);
      break;
  }
}

/**
 * Changes a lesson or a recipe of an agent.
 *
 * @param request - What to change.
 * @returns The fresh overview, or why the server refused the change.
 */
export async function sendAgentLessonsRequest(
  request: AgentLessonsRequest,
): Promise<AgentLessonsResponse> {
  const form = new FormData();
  form.set("intent", request.intent);
  form.set("agentId", request.agentId);
  appendFields(form, request);
  return postDreamingEndpoint(AGENT_LESSONS_ENDPOINT, form, isLessonsResponse);
}
