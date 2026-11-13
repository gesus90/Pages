import { randomUUID } from "node:crypto";

import { AGENT_RECIPE_LIMIT } from "@/definition/AgentDreaming";

import { checkRecipeDraft, recipeName } from "./AgentRecipeRules";

import type { StoredAgentRecipe } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentDreamLogEntry } from "@/definition/AgentDreaming";
import type { AgentDreamAnswer } from "./AgentLearningPrompt";

/** Days a recipe may go unused before it counts as rarely used. */
const RARELY_USED_DAYS = 45;
/** Uses from which a recipe stays however long ago the last one was. */
const KEPT_USES = 3;
const DAY_MILLISECONDS = 24 * 3_600_000;

/** What the curation of the recipes needs besides the answer of the run. */
export interface AgentRecipeCurationInput {
  readonly store: Pick<EmployeeStore, "recipes" | "toolUses">;
  readonly agentId: string;
  readonly answer: Pick<AgentDreamAnswer, "recipes" | "dropRecipes">;
  /** `YYYY-MM-DD`. */
  readonly today: string;
  readonly now: Date;
  readonly createId?: () => string;
}

/** When a recipe last counted: its last use, else its last confirmation. */
function lastActivity(recipe: StoredAgentRecipe): number {
  return Date.parse(recipe.lastUsedAt ?? `${recipe.confirmedOn}T00:00:00Z`);
}

/**
 * A recipe the dream run made that was weak from the start, is used rarely and
 * has not been used for a long time. What somebody wrote by hand stays.
 */
function isRarelyUsed(recipe: StoredAgentRecipe, now: Date): boolean {
  return (
    recipe.origin === "dream" &&
    recipe.strength <= 1 &&
    recipe.useCount < KEPT_USES &&
    now.getTime() - lastActivity(recipe) > RARELY_USED_DAYS * DAY_MILLISECONDS
  );
}

/** The recipes to drop for room, those of the dream run only: the weakest, least used and oldest first. */
function weakest(recipes: readonly StoredAgentRecipe[]): StoredAgentRecipe[] {
  return recipes
    .filter((recipe) => recipe.origin === "dream")
    .sort(
      (left, right) =>
        left.strength + left.useCount - (right.strength + right.useCount) ||
        lastActivity(left) - lastActivity(right),
    );
}

/**
 * Applies what a dream run says about the recipes (PAGE-378): drops the ones
 * it names, creates and corrects the ones it proposes, lets rarely used ones
 * fall out and keeps the number of recipes within its limit.
 *
 * @remarks
 * A proposal Pages cannot accept, such as a step with a tool the agent never
 * used or one that deletes, is left out. A correction of a recipe that was
 * switched off for failing switches it on again; one switched off by hand
 * stays off. The recipes take effect at once, without approval.
 *
 * @returns The lines of the log of the run.
 */
export async function curateRecipes(
  input: AgentRecipeCurationInput,
): Promise<AgentDreamLogEntry[]> {
  const { store, agentId, today, now } = input;
  const recipes = store.recipes();
  const log: AgentDreamLogEntry[] = [];
  const known = new Set(await store.toolUses().toolNames(agentId));
  let current = await recipes.list(agentId);
  const drop = async (
    recipe: StoredAgentRecipe,
    reason: string,
  ): Promise<void> => {
    await recipes.remove(agentId, [recipe.id]);
    current = current.filter((entry) => entry.id !== recipe.id);
    log.push({ kind: "recipeDropped", text: `${recipe.name} (${reason})` });
  };
  for (const name of input.answer.dropRecipes) {
    const recipe = current.find((entry) => entry.name === recipeName(name));
    if (recipe) await drop(recipe, "verworfen");
  }
  for (const draft of input.answer.recipes) {
    const checked = checkRecipeDraft(draft, {
      today,
      strength: 1,
      knownTools: known,
    });
    if (!checked.isValid) continue;
    const existing = current.find(
      (entry) => entry.name === checked.content.name,
    );
    if (existing) {
      await recipes.update(
        agentId,
        existing.id,
        { ...checked.content, strength: existing.strength + 1 },
        { reactivate: true },
      );
      log.push({ kind: "recipeUpdated", text: checked.content.name });
      current = await recipes.list(agentId);
      continue;
    }
    for (const weak of weakest(current).slice(
      0,
      Math.max(0, current.length + 1 - AGENT_RECIPE_LIMIT),
    ))
      await drop(weak, "Platz für ein neues");
    await recipes.insert({
      ...checked.content,
      id: input.createId?.() ?? randomUUID(),
      agentId,
      origin: "dream",
    });
    log.push({ kind: "recipeCreated", text: checked.content.name });
    current = await recipes.list(agentId);
  }
  for (const recipe of current.filter((entry) => isRarelyUsed(entry, now)))
    await drop(recipe, "selten genutzt");
  return log;
}
