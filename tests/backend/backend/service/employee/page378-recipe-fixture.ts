import type {
  AgentRecipeContent,
  NewAgentRecipe,
  StoredAgentRecipe,
} from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { StoredAgentToolUse } from "@/backend/database/repositories/employee/AgentToolUseRepository";
import type { AgentRecipeServiceDependencies } from "@/backend/service/employee/AgentRecipeService";
import type { AgentToolUse } from "@/definition/AgentDreaming";
import { partialStub } from "../../stub-fixture";

export const AGENT = "ed";

type RecipeStore = AgentRecipeServiceDependencies["store"];
type RecipeRepository = ReturnType<RecipeStore["recipes"]>;
type ToolUseRepository = ReturnType<RecipeStore["toolUses"]>;

/** A stored flow recipe with sensible defaults; every part can be overridden. */
export function recipe(
  overrides: Partial<StoredAgentRecipe> = {},
): StoredAgentRecipe {
  return {
    id: "recipe-1",
    agentId: AGENT,
    name: "ticket-anlegen",
    kind: "flow",
    summary: "Legt ein Ticket an und liest es zur Kontrolle.",
    keywords: ["ticket"],
    parameters: [{ name: "projekt", description: "ID des Projekts" }],
    steps: [
      {
        tool: "tickets_search",
        input: { projectId: "{{projekt}}" },
        note: "Optionen lesen",
      },
      {
        tool: "tickets_create",
        input: { projectId: "{{projekt}}", title: "Neu" },
        note: "anlegen",
      },
      {
        tool: "tickets_read",
        input: { ticketId: "{{2.id}}" },
        note: "Kontrolle",
      },
    ],
    body: "",
    evidence: "3× in Sitzungen",
    confirmedOn: "2026-11-01",
    strength: 2,
    useCount: 0,
    lastUsedAt: null,
    isActive: true,
    disabledReason: null,
    failureStreak: 0,
    lastError: null,
    origin: "dream",
    createdAt: "2026-11-01 10:00:00",
    ...overrides,
  };
}

/** An in-memory store of recipes and tool uses with the statements the real repositories make. */
export class FakeRecipes {
  public recipes: StoredAgentRecipe[] = [];
  public uses: StoredAgentToolUse[] = [];
  public readonly confidential = new Set<string>();
  private nextUse = 1;

  /** The store the recipe service reads and writes, backed by this fake. */
  public store(): RecipeStore {
    return partialStub<RecipeStore>({
      recipes: () => this.recipeRepository(),
      toolUses: () => this.toolUseRepository(),
      chatSessions: () => ({
        find: async (sessionId: string) =>
          sessionId === "gone"
            ? null
            : { kind: "direct", chatId: sessionId, chatName: "Igor" },
      }),
      chats: () => ({
        isConfidential: async (agent: string, chat: { personId: string }) =>
          this.confidential.has(chat.personId),
        isConfidentialConversation: async () => false,
      }),
    });
  }

  private recipeRepository(): RecipeRepository {
    return partialStub<RecipeRepository>({
      list: async () => [...this.recipes],
      active: async () => this.recipes.filter((entry) => entry.isActive),
      findByName: async (agent: string, name: string) =>
        this.recipes.find((entry) => entry.name === name) ?? null,
      findById: async (agent: string, id: string) =>
        this.recipes.find((entry) => entry.id === id) ?? null,
      insert: async (entry: NewAgentRecipe) => {
        this.recipes.push(
          recipe({
            ...entry,
            createdAt: "2026-11-13 10:00:00",
            origin: entry.origin,
          }),
        );
      },
      update: async (
        agent: string,
        id: string,
        content: AgentRecipeContent,
        options: { reactivate: boolean },
      ) => {
        const index = this.recipes.findIndex((entry) => entry.id === id);
        const current = this.recipes[index];
        if (!current) return false;
        const revive =
          options.reactivate && current.disabledReason === "failed";
        this.recipes[index] = {
          ...current,
          ...content,
          isActive: revive ? true : current.isActive,
          disabledReason: revive ? null : current.disabledReason,
          failureStreak: options.reactivate ? 0 : current.failureStreak,
          lastError: options.reactivate ? null : current.lastError,
        };
        return true;
      },
      setActive: async (agent: string, id: string, isActive: boolean) => {
        const index = this.recipes.findIndex((entry) => entry.id === id);
        const current = this.recipes[index];
        if (!current) return false;
        this.recipes[index] = {
          ...current,
          isActive,
          disabledReason: isActive ? null : "manual",
          failureStreak: isActive ? 0 : current.failureStreak,
          lastError: isActive ? null : current.lastError,
        };
        return true;
      },
      recordUse: async (agent: string, id: string, at: string) => {
        const index = this.recipes.findIndex((entry) => entry.id === id);
        const current = this.recipes[index];
        if (current)
          this.recipes[index] = {
            ...current,
            useCount: current.useCount + 1,
            lastUsedAt: at,
            failureStreak: 0,
            lastError: null,
          };
      },
      recordFailure: async (
        agent: string,
        id: string,
        failure: { error: string; limit: number },
      ) => {
        const index = this.recipes.findIndex((entry) => entry.id === id);
        const current = this.recipes[index];
        if (!current) return null;
        const streak = current.failureStreak + 1;
        const off = streak >= failure.limit;
        this.recipes[index] = {
          ...current,
          failureStreak: streak,
          lastError: failure.error,
          isActive: off ? false : current.isActive,
          disabledReason: off
            ? (current.disabledReason ?? "failed")
            : current.disabledReason,
        };
        return { failureStreak: streak, isActive: !off && current.isActive };
      },
      remove: async (agent: string, ids: readonly string[]) => {
        const before = this.recipes.length;
        this.recipes = this.recipes.filter((entry) => !ids.includes(entry.id));
        return before - this.recipes.length;
      },
    });
  }

  private toolUseRepository(): ToolUseRepository {
    return partialStub<ToolUseRepository>({
      append: async (agent: string, use: AgentToolUse) => {
        this.uses.push({
          ...use,
          id: this.nextUse++,
          at: "2026-11-13 10:00:00",
        });
      },
      since: async (agent: string, cursor: number, limit: number) =>
        this.uses.filter((use) => use.id > cursor).slice(0, limit),
      toolNames: async () => [...new Set(this.uses.map((use) => use.tool))],
      prune: async () => undefined,
    });
  }
}
