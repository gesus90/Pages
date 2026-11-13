import { TOOL_USE_RETENTION_DAYS } from "@/backend/database/repositories/employee/AgentToolUseRepository";
import { logCaughtError } from "@/backend/logging/Logger";
import { AGENT_RECIPE_FAILURE_LIMIT } from "@/definition/AgentDreaming";

import { runRecipe } from "./AgentRecipeRunner";
import { RECIPE_INPUT_SCHEMA, recipeName } from "./AgentRecipeRules";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentRecipe } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type {
  AgentRecipeAnswer,
  AgentRecipeStepRunner,
  AgentRecipeTools,
  AgentToolUse,
} from "@/definition/AgentDreaming";
import type { AgentRecipeRunOutcome } from "./AgentRecipeRunner";

/** Recipes a session lists beside their short descriptions at most. */
const LISTED_RECIPES = 30;
/** Knowledge recipes one round loads at most. */
const LOADED_KNOWLEDGE = 3;
/** Shortest word of a message that counts for a knowledge recipe. */
const TOPIC_WORD_LENGTH = 4;
/** Tool calls after which the old ones are dropped. */
const PRUNE_EVERY_CALLS = 200;
/** Errors that say nothing about the recipe: the turn ran out of calls. */
const NEUTRAL_ERRORS: ReadonlySet<string> = new Set(["STEP_LIMIT"]);

/** What the recipes read and write. */
export interface AgentRecipeServiceDependencies {
  readonly store: Pick<
    EmployeeStore,
    "recipes" | "toolUses" | "chatSessions" | "chats"
  >;
  readonly now?: () => Date;
}

/** The chat session a call of the tools comes from. */
export interface AgentRecipeSession {
  readonly agentId: string;
  readonly sessionId: string;
}

/** One recipe as a session lists it: its name and a short description. */
export interface AgentRecipeListing {
  readonly name: string;
  readonly kind: StoredAgentRecipe["kind"];
  readonly summary: string;
  readonly parameters: readonly string[];
}

/** What a round of a chat session is told about the recipes of its agent. */
export interface AgentRecipeBrief {
  /** Every recipe that is on, by name and short description. */
  readonly available: readonly AgentRecipeListing[];
  /** The guides of the knowledge recipes that fit the topic of the round. */
  readonly knowledge: readonly {
    readonly name: string;
    readonly body: string;
  }[];
}

function listing(recipe: StoredAgentRecipe): AgentRecipeListing {
  return {
    name: recipe.name,
    kind: recipe.kind,
    summary: recipe.summary,
    parameters: recipe.parameters.map((parameter) => parameter.name),
  };
}

function refused(
  error: string,
  result: Record<string, unknown>,
): AgentRecipeAnswer {
  return { isOk: false, error, result };
}

/** How well a knowledge recipe fits a text: its keywords and name parts the text contains. */
function topicScore(recipe: StoredAgentRecipe, text: string): number {
  const lower = text.toLocaleLowerCase();
  const nameParts = recipe.name
    .split(/[-_]/u)
    .filter((part) => part.length >= TOPIC_WORD_LENGTH);
  return [...recipe.keywords, ...nameParts].filter((word) =>
    lower.includes(word),
  ).length;
}

/**
 * The knowledge recipes that fit a text, the best fit first.
 *
 * @param recipes - The recipes that are on.
 * @param text - The message of the round.
 */
export function matchKnowledgeRecipes(
  recipes: readonly StoredAgentRecipe[],
  text: string,
): StoredAgentRecipe[] {
  return recipes
    .filter((recipe) => recipe.kind === "knowledge")
    .map((recipe) => ({ recipe, score: topicScore(recipe, text) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.recipe.strength - left.recipe.strength,
    )
    .slice(0, LOADED_KNOWLEDGE)
    .map((entry) => entry.recipe);
}

/**
 * The recipes of agents (PAGE-378): the tool `rezept(name, parameter)` of a
 * chat session, the record of its tool calls and what a round is told about
 * its recipes.
 *
 * @remarks
 * A recipe takes effect at once, without approval, but it chains only tools
 * the session offers, never runs one that needs the normal confirmation, and
 * is switched off after two failed calls in a row. The record of tool calls
 * is left out for a confidential chat.
 */
export class AgentRecipeService {
  private readonly dependencies: AgentRecipeServiceDependencies;
  private readonly callCounts = new Map<string, number>();

  public constructor(dependencies: AgentRecipeServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The recipe tools of one chat session, bound to its agent.
   *
   * @param session - The agent and the chat session.
   */
  public tools(session: AgentRecipeSession): AgentRecipeTools {
    let isConfidential: Promise<boolean> | null = null;
    return {
      run: (input, runner) => this.run(session.agentId, input, runner),
      note: (call) => {
        isConfidential ??= this.isConfidential(session);
        void isConfidential
          .then((hidden) =>
            hidden ? undefined : this.record(session.agentId, call),
          )
          .catch((error: unknown) => {
            logCaughtError("AgentRecipeService", error);
          });
      },
    };
  }

  /**
   * What a round is told about the recipes of an agent: the list of those
   * that are on and the guides that fit its message.
   *
   * @param agentId - The agent.
   * @param text - The message of the round.
   */
  public async brief(agentId: string, text: string): Promise<AgentRecipeBrief> {
    const recipes = await this.dependencies.store.recipes().active(agentId);
    return {
      available: recipes.slice(0, LISTED_RECIPES).map(listing),
      knowledge: matchKnowledgeRecipes(recipes, text).map((recipe) => ({
        name: recipe.name,
        body: recipe.body,
      })),
    };
  }

  private async run(
    agentId: string,
    input: unknown,
    runner: AgentRecipeStepRunner,
  ): Promise<AgentRecipeAnswer> {
    const parsed = RECIPE_INPUT_SCHEMA.safeParse(input);
    if (!parsed.success)
      return refused("INVALID_REQUEST", {
        hinweis:
          "name ist ein Text, parameter ein Objekt mit Texten, Zahlen und Wahrheitswerten.",
      });
    const recipes = this.dependencies.store.recipes();
    const all = await recipes.list(agentId);
    const requested = parsed.data.name ?? "";
    if (requested === "")
      return {
        isOk: true,
        error: null,
        result: {
          rezepte: all.filter((recipe) => recipe.isActive).map(listing),
        },
      };
    const name = recipeName(requested);
    const recipe = all.find((entry) => entry.name === name);
    if (!recipe)
      return refused("NOT_FOUND", {
        hinweis: "Kein Rezept dieses Namens.",
        verfuegbar: all
          .filter((entry) => entry.isActive)
          .map((entry) => entry.name),
      });
    if (!recipe.isActive)
      return refused("RECIPE_DISABLED", {
        hinweis:
          "Das Rezept ist ausgeschaltet; der nächste Traumlauf korrigiert oder verwirft es. Arbeite ohne es.",
        grund: recipe.disabledReason,
        letzterFehler: recipe.lastError,
      });
    if (recipe.kind === "knowledge") return this.readGuide(agentId, recipe);
    return this.runFlow(agentId, recipe, {
      parameters: parsed.data.parameter ?? {},
      runner,
    });
  }

  /** A knowledge recipe answers with its guide; asking for it counts as a use. */
  private async readGuide(
    agentId: string,
    recipe: StoredAgentRecipe,
  ): Promise<AgentRecipeAnswer> {
    await this.dependencies.store
      .recipes()
      .recordUse(agentId, recipe.id, this.now().toISOString());
    return {
      isOk: true,
      error: null,
      result: { rezept: recipe.name, art: "wissen", anleitung: recipe.body },
    };
  }

  private async runFlow(
    agentId: string,
    recipe: StoredAgentRecipe,
    call: {
      readonly parameters: Readonly<Record<string, unknown>>;
      readonly runner: AgentRecipeStepRunner;
    },
  ): Promise<AgentRecipeAnswer> {
    const outcome = await runRecipe(recipe, call.parameters, call.runner);
    return this.settle(agentId, recipe, outcome);
  }

  /** Counts the outcome on the recipe and words it for the model. */
  private async settle(
    agentId: string,
    recipe: StoredAgentRecipe,
    outcome: AgentRecipeRunOutcome,
  ): Promise<AgentRecipeAnswer> {
    const recipes = this.dependencies.store.recipes();
    if (outcome.status === "missing")
      return refused("INVALID_REQUEST", {
        rezept: recipe.name,
        fehlendeParameter: outcome.parameters,
      });
    if (outcome.status === "confirmation")
      return refused("CONFIRMATION_REQUIRED", {
        rezept: recipe.name,
        schritte: outcome.steps,
        bestaetigung: { schritt: outcome.step, werkzeug: outcome.tool },
        hinweis:
          "Dieser Schritt braucht die normale Bestätigung; ein Rezept führt ihn nie selbst aus. Rufe das Werkzeug selbst auf, wenn die Person es ausdrücklich verlangt, und mache mit den folgenden Schritten von Hand weiter.",
      });
    if (outcome.status === "done") {
      await recipes.recordUse(agentId, recipe.id, this.now().toISOString());
      return {
        isOk: true,
        error: null,
        result: {
          rezept: recipe.name,
          schritte: outcome.steps,
          ergebnis: outcome.result,
        },
      };
    }
    const failure = NEUTRAL_ERRORS.has(outcome.error)
      ? null
      : await recipes.recordFailure(agentId, recipe.id, {
          error: `${outcome.tool}: ${outcome.error}`,
          limit: AGENT_RECIPE_FAILURE_LIMIT,
        });
    return refused("RECIPE_FAILED", {
      rezept: recipe.name,
      schritte: outcome.steps,
      gescheitert: {
        schritt: outcome.step,
        werkzeug: outcome.tool,
        fehler: outcome.error,
      },
      ausgeschaltet: failure !== null && !failure.isActive,
      hinweis:
        "Das Rezept ist gescheitert. Mache den Rest von Hand; schlägt es zweimal hintereinander fehl, wird es ausgeschaltet.",
    });
  }

  /** A chat is confidential when its direct chat or its conversation is marked so. */
  private async isConfidential(session: AgentRecipeSession): Promise<boolean> {
    const { store } = this.dependencies;
    const chat = await store.chatSessions().find(session.sessionId);
    if (!chat) return true;
    return chat.kind === "direct"
      ? store.chats().isConfidential(session.agentId, {
          kind: "person",
          personId: chat.chatId,
        })
      : store.chats().isConfidentialConversation(session.agentId, chat.chatId);
  }

  private async record(agentId: string, call: AgentToolUse): Promise<void> {
    const uses = this.dependencies.store.toolUses();
    await uses.append(agentId, call);
    const count = (this.callCounts.get(agentId) ?? 0) + 1;
    this.callCounts.set(agentId, count % PRUNE_EVERY_CALLS);
    if (count % PRUNE_EVERY_CALLS !== 0) return;
    const before = new Date(
      this.now().getTime() - TOOL_USE_RETENTION_DAYS * 24 * 3_600_000,
    );
    await uses.prune(
      agentId,
      before.toISOString().slice(0, 19).replace("T", " "),
    );
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
