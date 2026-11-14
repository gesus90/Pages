import {
  carriesConfirmation,
  fillPlaceholders,
  RecipeValueError,
} from "./AgentRecipeRules";

import type { StoredAgentRecipe } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { AgentRecipeStepRunner } from "@/definition/AgentDreaming";
import type { RecipeValues } from "./AgentRecipeRules";

/** Characters of the result of a step the report keeps beside its status. */
const STEP_SUMMARY_CHARACTERS = 200;
/** Characters of the result of the last step the report returns. */
const RESULT_CHARACTERS = 6_000;

/** What one step did. */
export interface AgentRecipeStepReport {
  readonly nr: number;
  readonly werkzeug: string;
  readonly ok: boolean;
  /** The start of the result, or the error code. */
  readonly kurz: string;
}

/** How a run of a flow recipe ended. */
export type AgentRecipeRunOutcome =
  | {
      readonly status: "done";
      readonly steps: readonly AgentRecipeStepReport[];
      /** The result of the last step. */
      readonly result: string;
    }
  | {
      readonly status: "failed";
      readonly steps: readonly AgentRecipeStepReport[];
      readonly step: number;
      readonly tool: string;
      readonly error: string;
    }
  | {
      /** A step needs the normal confirmation, which the recipe never gives. */
      readonly status: "confirmation";
      readonly steps: readonly AgentRecipeStepReport[];
      readonly step: number;
      readonly tool: string;
    }
  | {
      /** The caller left out parameters; the recipe is not at fault. */
      readonly status: "missing";
      readonly parameters: readonly string[];
    };

function cut(text: string, maximum: number): string {
  const characters = Array.from(text);
  return characters.length <= maximum
    ? text
    : `${characters.slice(0, maximum).join("")} […]`;
}

/** The parsed result of a step; a result that is no JSON stays a text. */
function parsedResult(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return text;
    throw error;
  }
}

/** The input of a step with its placeholders filled; `null` for a value that is missing. */
function stepInput(
  recipe: StoredAgentRecipe,
  index: number,
  values: RecipeValues,
): Readonly<Record<string, unknown>> | null {
  const step = recipe.steps[index];
  if (!step) return null;
  try {
    const filled = fillPlaceholders(step.input, values);
    return typeof filled === "object" &&
      filled !== null &&
      !Array.isArray(filled)
      ? Object.fromEntries(Object.entries(filled))
      : null;
  } catch (error: unknown) {
    if (error instanceof RecipeValueError) return null;
    throw error;
  }
}

/** The input of a step ready to run, or the error code that ends the run. */
function preparedStep(
  recipe: StoredAgentRecipe,
  index: number,
  context: {
    readonly offered: "ok" | "unknown" | "confirmation";
    readonly values: RecipeValues;
  },
):
  | { readonly input: Readonly<Record<string, unknown>> }
  | { readonly error: string } {
  if (context.offered === "unknown") return { error: "TOOL_UNAVAILABLE" };
  const input = stepInput(recipe, index, context.values);
  return input === null ? { error: "MISSING_VALUE" } : { input };
}

/**
 * Runs the tool chain of a flow recipe in one call.
 *
 * @remarks
 * Every step calls a tool of the session as the agent would, so the rights,
 * the checks and the budget of the tools stay as they are: the recipe grants
 * nothing. A step that is a deleting, removing or archiving tool, that
 * carries a confirmation, or that the tool itself answers with
 * `CONFIRMATION_REQUIRED` ends the run before anything more happens; the
 * agent then makes the call itself and asks the person as usual. A step that
 * fails ends the run as failed.
 *
 * @param recipe - The flow recipe.
 * @param parameters - What the caller gave for the parameters of the recipe.
 * @param runner - Calls the tools of the session.
 */
export async function runRecipe(
  recipe: StoredAgentRecipe,
  parameters: Readonly<Record<string, unknown>>,
  runner: AgentRecipeStepRunner,
): Promise<AgentRecipeRunOutcome> {
  const missing = recipe.parameters
    .map((parameter) => parameter.name)
    .filter((name) => parameters[name] === undefined);
  if (missing.length > 0) return { status: "missing", parameters: missing };
  const reports: AgentRecipeStepReport[] = [];
  const results: unknown[] = [];
  let last = "";
  for (const [index, step] of recipe.steps.entries()) {
    const nr = index + 1;
    const offered = runner.offers(step.tool);
    if (offered === "confirmation" || carriesConfirmation(step.input))
      return {
        status: "confirmation",
        steps: reports,
        step: nr,
        tool: step.tool,
      };
    const prepared = preparedStep(recipe, index, {
      offered,
      values: { parameters, results },
    });
    const outcome =
      "input" in prepared
        ? await runner.call(step.tool, prepared.input)
        : { isOk: false as const, error: prepared.error, result: null };
    if (!outcome.isOk) {
      if (outcome.error === "CONFIRMATION_REQUIRED")
        return {
          status: "confirmation",
          steps: reports,
          step: nr,
          tool: step.tool,
        };
      reports.push({ nr, werkzeug: step.tool, ok: false, kurz: outcome.error });
      return {
        status: "failed",
        steps: reports,
        step: nr,
        tool: step.tool,
        error: outcome.error,
      };
    }
    last = outcome.result;
    results.push(parsedResult(outcome.result));
    reports.push({
      nr,
      werkzeug: step.tool,
      ok: true,
      kurz: cut(outcome.result, STEP_SUMMARY_CHARACTERS),
    });
  }
  return {
    status: "done",
    steps: reports,
    result: cut(last, RESULT_CHARACTERS),
  };
}
