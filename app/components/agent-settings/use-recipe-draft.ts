import { useState } from "react";

import {
  checkRecipeForm,
  createRecipeForm,
  createRowKey,
  hasRecipeProblems,
  readRecipeForm,
} from "./agent-recipe-draft";

import type {
  ParameterRow,
  RecipeForm,
  RecipeProblems,
  RecipeTextField,
  StepRow,
} from "./agent-recipe-draft";
import type { AgentRecipeInput } from "./agent-lessons-api";
import type { AgentRecipeView } from "@/definition/AgentDreaming";

/** What a row of parameters changes: everything but its key. */
export type ParameterPatch = Partial<Omit<ParameterRow, "key">>;

/** What a row of steps changes: everything but its key. */
export type StepPatch = Partial<Omit<StepRow, "key">>;

/** The entries of the editor of a recipe, what is wrong with them and what they would save. */
export interface RecipeDraft {
  readonly form: RecipeForm;
  readonly problems: RecipeProblems;
  /** The recipe to save; `null` while an entry is wrong. */
  readonly input: AgentRecipeInput | null;
  setText(field: RecipeTextField, text: string): void;
  addParameter(): void;
  updateParameter(key: number, patch: ParameterPatch): void;
  removeParameter(key: number): void;
  addStep(): void;
  updateStep(key: number, patch: StepPatch): void;
  removeStep(key: number): void;
}

/**
 * The entries of the editor of one recipe, checked before anything is sent
 * (PAGE-378).
 *
 * @param recipe - The recipe the server holds; it fills the entries.
 */
export function useRecipeDraft(recipe: AgentRecipeView): RecipeDraft {
  const [form, setForm] = useState(() => createRecipeForm(recipe));
  const problems = checkRecipeForm(recipe, form);

  function addParameter(): void {
    const row = { key: createRowKey(), name: "", description: "" };
    setForm((current) => ({
      ...current,
      parameters: [...current.parameters, row],
    }));
  }

  function addStep(): void {
    const row = { key: createRowKey(), tool: "", note: "", inputText: "{}" };
    setForm((current) => ({ ...current, steps: [...current.steps, row] }));
  }

  return {
    form,
    problems,
    input: hasRecipeProblems(problems) ? null : readRecipeForm(recipe, form),
    setText: (field, text) =>
      setForm((current) => ({ ...current, [field]: text })),
    addParameter,
    updateParameter: (key, patch) =>
      setForm((current) => ({
        ...current,
        parameters: current.parameters.map((row) =>
          row.key === key ? { ...row, ...patch } : row,
        ),
      })),
    removeParameter: (key) =>
      setForm((current) => ({
        ...current,
        parameters: current.parameters.filter((row) => row.key !== key),
      })),
    addStep,
    updateStep: (key, patch) =>
      setForm((current) => ({
        ...current,
        steps: current.steps.map((row) =>
          row.key === key ? { ...row, ...patch } : row,
        ),
      })),
    removeStep: (key) =>
      setForm((current) => ({
        ...current,
        steps: current.steps.filter((row) => row.key !== key),
      })),
  };
}
