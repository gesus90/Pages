import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { stripCredentials } from "@/backend/service/employee/AgentEmployeeText";
import {
  RECIPE_INPUT_SCHEMA,
  RECIPE_TOOL,
  classifyRecipeTool,
} from "@/backend/service/employee/AgentRecipeRules";

import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  RuntimeToolCall,
  RuntimeToolRegistry,
} from "@/backend/agents/runtime/RuntimeToolRegistry";
import type {
  AgentRecipeStepRunner,
  AgentRecipeTools,
  AgentToolUse,
} from "@/definition/AgentDreaming";
import type { RecipeInput } from "@/backend/service/employee/AgentRecipeRules";
import type { PicaToolOutcome } from "./PicaToolSchemas";

/** Characters of the input of a call the record keeps. */
const INPUT_CHARACTERS = 300;
/** Characters of the result of a call the record keeps. */
const OUTPUT_CHARACTERS = 240;

const RECIPE_DESCRIPTION =
  "Run a recipe: a fixed chain of tool calls you learned, in ONE call instead of calling each tool yourself. rezept(name, parameter) runs the flow recipe `name` with its parameters (an object, see the list of recipes in your instructions) and returns the status of every step and the result of the last one; for a knowledge recipe it returns its guide. rezept() without a name lists your recipes. A recipe uses only tools you may use anyway and never deletes, removes or archives: a step that needs the normal confirmation stops the recipe, and you make that call yourself after the person asked for it. A recipe that fails twice in a row is switched off.";

function cut(text: string, maximum: number): string {
  const masked = stripCredentials(text.replace(/\s+/gu, " ").trim());
  const characters = Array.from(masked);
  return characters.length <= maximum
    ? masked
    : `${characters.slice(0, maximum).join("")}…`;
}

/** The record of one call: tool, input and the start of the result, bounded and masked. */
function describeCall(call: RuntimeToolCall): AgentToolUse {
  const outcome = call.invocation.isValid
    ? PICA_TOOL_OUTCOME.safeParse(call.invocation.output)
    : null;
  const answer = outcome?.success === true ? outcome.data : null;
  return {
    tool: call.id,
    input: cut(JSON.stringify(call.input) ?? "", INPUT_CHARACTERS),
    output: cut(answer?.result ?? "", OUTPUT_CHARACTERS),
    isOk: answer?.ok === true,
    error: call.invocation.isValid ? (answer?.error ?? null) : "INVALID_INPUT",
  };
}

/**
 * Hands every call of the tools of a turn to the record the dream run learns
 * from (PAGE-378). A failing record never fails a call.
 *
 * @param registry - The tools of the turn.
 * @param recipes - The record of the agent's chat session.
 */
export function observePicaToolUse(
  registry: RuntimeToolRegistry,
  recipes: Pick<AgentRecipeTools, "note">,
): void {
  registry.observe((call) => {
    try {
      recipes.note(describeCall(call));
    } catch (error: unknown) {
      logCaughtError("PicaRecipeTool", error);
    }
  });
}

/** Answers a call the recipe makes: the tool's own outcome, or why it was not made. */
async function callStep(
  registry: RuntimeToolRegistry,
  context: RuntimeExecutionContext,
  step: { readonly tool: string; readonly input: unknown },
): ReturnType<AgentRecipeStepRunner["call"]> {
  try {
    const invoked = await registry.invoke(step.tool, step.input, context);
    if (invoked === null)
      return { isOk: false, error: "TOOL_UNAVAILABLE", result: null };
    if (!invoked.isValid)
      return { isOk: false, error: "INVALID_INPUT", result: null };
    const outcome = PICA_TOOL_OUTCOME.safeParse(invoked.output);
    if (!outcome.success) return { isOk: false, error: "FAILED", result: null };
    return outcome.data.ok
      ? { isOk: true, result: outcome.data.result ?? "" }
      : {
          isOk: false,
          error: outcome.data.error ?? "FAILED",
          result: outcome.data.result,
        };
  } catch (error: unknown) {
    // A stopped job ends the recipe with it; any other error is a failed step.
    if (context.signal.aborted) throw error;
    logCaughtError("PicaRecipeTool", error);
    return { isOk: false, error: "FAILED", result: null };
  }
}

/** What a recipe step may call in this turn: tools of the registry, never administrator ones. */
function stepRunner(
  registry: RuntimeToolRegistry,
  context: RuntimeExecutionContext,
): AgentRecipeStepRunner {
  return {
    offers: (tool) => {
      const access = registry.accessOf(tool);
      if (access === null || classifyRecipeTool(tool) === "unusable")
        return "unknown";
      // Administrator tools carry their own consent for critical changes.
      return access === "administrator" ||
        classifyRecipeTool(tool) === "confirmation"
        ? "confirmation"
        : "ok";
    },
    call: (tool, input) => callStep(registry, context, { tool, input }),
  };
}

/**
 * Registers `rezept(name, parameter)` (PAGE-378). The recipe tool runs the
 * tool chain of a recipe through the same registry the agent calls, so a
 * recipe has exactly the tools and rights the agent has and no more.
 *
 * @param registry - The tools of the turn; the recipe calls its other tools.
 * @param input - The authorization of the turn and the recipes of the agent.
 * @param spend - Takes one call from the budget; `false` once it is used up.
 */
export function registerPicaRecipeTool(
  registry: RuntimeToolRegistry,
  input: {
    readonly authorize: () => Promise<void>;
    readonly recipes: AgentRecipeTools;
  },
  spend: () => boolean,
): void {
  registry.register<RecipeInput, PicaToolOutcome>({
    id: RECIPE_TOOL,
    description: RECIPE_DESCRIPTION,
    inputSchema: RECIPE_INPUT_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: async (parameters, context) => {
      await input.authorize();
      context.signal.throwIfAborted();
      if (!spend()) return { ok: false, result: null, error: "STEP_LIMIT" };
      const answer = await input.recipes.run(
        parameters,
        stepRunner(registry, context),
      );
      return {
        ok: answer.isOk,
        result: redactCredentials(JSON.stringify(answer.result)),
        error: answer.error,
      };
    },
  });
}
