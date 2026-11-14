import {
  AGENT_RECIPE_BODY_CHARACTERS,
  AGENT_RECIPE_NAME_CHARACTERS,
  AGENT_RECIPE_SUMMARY_CHARACTERS,
} from "@/definition/AgentDreaming";

import {
  formatStepInput,
  parseKeywords,
  readJsonObject,
} from "./agent-lessons-display";

import type { AgentRecipeInput } from "./agent-lessons-api";
import type {
  AgentRecipeParameter,
  AgentRecipeStep,
  AgentRecipeView,
} from "@/definition/AgentDreaming";

/** One parameter in the editor; the key keeps its entries while rows come and go. */
export interface ParameterRow {
  readonly key: number;
  readonly name: string;
  readonly description: string;
}

/** One step in the editor; the input is the text of a JSON object. */
export interface StepRow {
  readonly key: number;
  readonly tool: string;
  readonly note: string;
  readonly inputText: string;
}

/** What the editor of a recipe holds while it is edited. */
export interface RecipeForm {
  readonly name: string;
  readonly summary: string;
  /** The keywords, comma separated. */
  readonly keywordsText: string;
  readonly body: string;
  readonly parameters: readonly ParameterRow[];
  readonly steps: readonly StepRow[];
}

/** What is wrong with the entries; each flag shows its message next to the field. */
export interface RecipeProblems {
  readonly hasNameProblem: boolean;
  readonly hasSummaryProblem: boolean;
  /** A knowledge recipe without a guide, or with one that is too long. */
  readonly hasBodyProblem: boolean;
  /** A flow recipe without a step. */
  readonly hasNoSteps: boolean;
  readonly hasParameterProblem: boolean;
  /** Per step: whether it names no tool. */
  readonly stepToolProblems: readonly boolean[];
  /** Per step: whether its input is no JSON object. */
  readonly stepInputProblems: readonly boolean[];
}

/** The text fields of the form, which one text input changes. */
export type RecipeTextField = "name" | "summary" | "keywordsText" | "body";

let lastRowKey = 0;

/** A key no other row of the editor has. */
export function createRowKey(): number {
  lastRowKey += 1;
  return lastRowKey;
}

/**
 * The entries that show a recipe as the server holds it.
 *
 * @param recipe - The recipe to edit.
 */
export function createRecipeForm(recipe: AgentRecipeView): RecipeForm {
  return {
    name: recipe.name,
    summary: recipe.summary,
    keywordsText: recipe.keywords.join(", "),
    body: recipe.body,
    parameters: recipe.parameters.map((parameter) => ({
      key: createRowKey(),
      ...parameter,
    })),
    steps: recipe.steps.map((step) => ({
      key: createRowKey(),
      tool: step.tool,
      note: step.note,
      inputText: formatStepInput(step.input),
    })),
  };
}

function isTextInRange(text: string, limit: number): boolean {
  const trimmed = text.trim();
  return trimmed !== "" && trimmed.length <= limit;
}

/**
 * What is wrong with the entries of a recipe.
 *
 * @param recipe - The recipe being edited; its kind decides what is checked.
 * @param form - The entries.
 */
export function checkRecipeForm(
  recipe: AgentRecipeView,
  form: RecipeForm,
): RecipeProblems {
  const isFlow = recipe.kind === "flow";
  return {
    hasNameProblem: !isTextInRange(form.name, AGENT_RECIPE_NAME_CHARACTERS),
    hasSummaryProblem: !isTextInRange(
      form.summary,
      AGENT_RECIPE_SUMMARY_CHARACTERS,
    ),
    hasBodyProblem:
      !isFlow && !isTextInRange(form.body, AGENT_RECIPE_BODY_CHARACTERS),
    hasNoSteps: isFlow && form.steps.length === 0,
    hasParameterProblem:
      isFlow && form.parameters.some((row) => row.name.trim() === ""),
    stepToolProblems: form.steps.map((row) => isFlow && row.tool.trim() === ""),
    stepInputProblems: form.steps.map(
      (row) => isFlow && readJsonObject(row.inputText) === null,
    ),
  };
}

/**
 * Whether any entry of the recipe is wrong.
 *
 * @param problems - What {@link checkRecipeForm} found.
 */
export function hasRecipeProblems(problems: RecipeProblems): boolean {
  return (
    problems.hasNameProblem ||
    problems.hasSummaryProblem ||
    problems.hasBodyProblem ||
    problems.hasNoSteps ||
    problems.hasParameterProblem ||
    problems.stepToolProblems.some(Boolean) ||
    problems.stepInputProblems.some(Boolean)
  );
}

function readParameters(form: RecipeForm): AgentRecipeParameter[] {
  return form.parameters.map((row) => ({
    name: row.name.trim(),
    description: row.description.trim(),
  }));
}

function readSteps(form: RecipeForm): AgentRecipeStep[] {
  return form.steps.map((row) => ({
    tool: row.tool.trim(),
    input: readJsonObject(row.inputText) ?? {},
    note: row.note.trim(),
  }));
}

/**
 * The recipe the entries stand for, ready to save.
 *
 * @remarks
 * What the editor does not show for a kind stays as the server holds it: a
 * flow recipe keeps its body, a knowledge recipe its parameters and steps.
 *
 * @param recipe - The recipe being edited.
 * @param form - The entries, free of problems.
 */
export function readRecipeForm(
  recipe: AgentRecipeView,
  form: RecipeForm,
): AgentRecipeInput {
  const isFlow = recipe.kind === "flow";
  return {
    recipeId: recipe.id,
    name: form.name.trim(),
    summary: form.summary.trim(),
    keywords: parseKeywords(form.keywordsText),
    body: isFlow ? recipe.body : form.body.trim(),
    parameters: isFlow ? readParameters(form) : recipe.parameters,
    steps: isFlow ? readSteps(form) : recipe.steps,
  };
}
