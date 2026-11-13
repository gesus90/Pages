import type {
  AgentRecipeContent,
  NewAgentRecipe,
  StoredAgentRecipe,
} from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { StoredAgentToolUse } from "@/backend/database/repositories/employee/AgentToolUseRepository";
import type { AgentRecipeServiceDependencies } from "@/backend/service/employee/AgentRecipeService";
import type { AgentToolUse } from "@/definition/AgentDreaming";

export const AGENT = "ed";

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

  public store(): AgentRecipeServiceDependencies["store"] {
    const self = this;
    return {
      recipes: () => ({
        list: async () => [...self.recipes],
        active: async () => self.recipes.filter((entry) => entry.isActive),
        findByName: async (_agent: string, name: string) =>
          self.recipes.find((entry) => entry.name === name) ?? null,
        findById: async (_agent: string, id: string) =>
          self.recipes.find((entry) => entry.id === id) ?? null,
        insert: async (entry: NewAgentRecipe) => {
          self.recipes.push(
            recipe({
              ...entry,
              createdAt: "2026-11-13 10:00:00",
              origin: entry.origin,
            }),
          );
        },
        update: async (
          _agent: string,
          id: string,
          content: AgentRecipeContent,
          options: { reactivate: boolean },
        ) => {
          const index = self.recipes.findIndex((entry) => entry.id === id);
          const current = self.recipes[index];
          if (!current) return false;
          const revive =
            options.reactivate && current.disabledReason === "failed";
          self.recipes[index] = {
            ...current,
            ...content,
            isActive: revive ? true : current.isActive,
            disabledReason: revive ? null : current.disabledReason,
            failureStreak: options.reactivate ? 0 : current.failureStreak,
            lastError: options.reactivate ? null : current.lastError,
          };
          return true;
        },
        setActive: async (_agent: string, id: string, isActive: boolean) => {
          const index = self.recipes.findIndex((entry) => entry.id === id);
          const current = self.recipes[index];
          if (!current) return false;
          self.recipes[index] = {
            ...current,
            isActive,
            disabledReason: isActive ? null : "manual",
            failureStreak: isActive ? 0 : current.failureStreak,
            lastError: isActive ? null : current.lastError,
          };
          return true;
        },
        recordUse: async (_agent: string, id: string, at: string) => {
          const index = self.recipes.findIndex((entry) => entry.id === id);
          const current = self.recipes[index];
          if (current)
            self.recipes[index] = {
              ...current,
              useCount: current.useCount + 1,
              lastUsedAt: at,
              failureStreak: 0,
              lastError: null,
            };
        },
        recordFailure: async (
          _agent: string,
          id: string,
          failure: { error: string; limit: number },
        ) => {
          const index = self.recipes.findIndex((entry) => entry.id === id);
          const current = self.recipes[index];
          if (!current) return null;
          const streak = current.failureStreak + 1;
          const off = streak >= failure.limit;
          self.recipes[index] = {
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
        remove: async (_agent: string, ids: readonly string[]) => {
          const before = self.recipes.length;
          self.recipes = self.recipes.filter(
            (entry) => !ids.includes(entry.id),
          );
          return before - self.recipes.length;
        },
      }),
      toolUses: () => ({
        append: async (_agent: string, use: AgentToolUse) => {
          self.uses.push({
            ...use,
            id: self.nextUse++,
            at: "2026-11-13 10:00:00",
          });
        },
        since: async (_agent: string, cursor: number, limit: number) =>
          self.uses.filter((use) => use.id > cursor).slice(0, limit),
        toolNames: async () => [...new Set(self.uses.map((use) => use.tool))],
        prune: async () => undefined,
      }),
      chatSessions: () => ({
        find: async (sessionId: string) =>
          sessionId === "gone"
            ? null
            : { kind: "direct", chatId: sessionId, chatName: "Igor" },
      }),
      chats: () => ({
        isConfidential: async (_agent: string, chat: { personId: string }) =>
          self.confidential.has(chat.personId),
        isConfidentialConversation: async () => false,
      }),
    } as unknown as AgentRecipeServiceDependencies["store"];
  }
}
