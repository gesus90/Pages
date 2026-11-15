import { vi } from "vitest";

import { AutomationError } from "@/backend/error/AutomationError";
import { firstRunAt } from "@/backend/service/automation/AutomationSchedule";
import { AgentChatTaskService } from "@/backend/service/employee/AgentChatTaskService";

import type {
  StoredAgentChatTask,
  StoredAgentChatTaskChat,
} from "@/backend/database/repositories/conversation/AgentChatTaskRepository";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationAccount } from "@/backend/service/automation/AutomationDirectory";
import type { AutomationAction, AutomationTrigger } from "@/definition/Automation";
import type { User } from "@/definition/User";

/** "Today" of every PAGE-392 test: Sunday, 15.11.2026, 14:00 in Berlin. */
export const NOW = new Date("2026-11-15T13:00:00.000Z");

const person = (id: string, displayName: string): User => ({
  id,
  username: id,
  displayName,
  role: "employee",
  isActive: true,
  mustChangePassword: false,
});

export const IGOR = person("igor", "Igor");
export const MAYA = person("maya", "Maya");
export const OUTSIDER = person("outsider", "Olaf");
export const AGENT: User = { ...person("agent", "All Might"), isAgent: true };
export const OTHER_AGENT: User = { ...person("agent-2", "Conan"), isAgent: true };

const USERS = new Map(
  [IGOR, MAYA, OUTSIDER, AGENT, OTHER_AGENT].map((user) => [user.id, user]),
);

/** The automations of the world, as AutomationService would keep them. */
export interface AutomationInput {
  readonly operationId: string;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly isActive: boolean;
  readonly deleteAfterSuccess: boolean;
}

/**
 * A world of scheduled tasks: the service on in-memory automations and
 * bindings, faked only at the boundaries of automations and conversations.
 */
export function chatTaskWorld(options: { readonly limit?: number } = {}): {
  readonly service: AgentChatTaskService;
  readonly automations: Map<string, StoredAutomation>;
  readonly bindings: Map<string, StoredAgentChatTask>;
  readonly create: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
  readonly setActive: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
} {
  const automations = new Map<string, StoredAutomation>();
  const bindings = new Map<string, StoredAgentChatTask>();
  let next = 0;
  const create = vi.fn(async (userId: string, input: AutomationInput) => {
    next += 1;
    const id = `automation-${String(next)}`;
    if (
      input.trigger.type === "once" &&
      Date.parse(input.trigger.at ?? "") <= NOW.getTime()
    )
      throw new AutomationError("invalid_request", { reason: "time_required" });
    automations.set(id, {
      id,
      creatorId: userId,
      name: input.name,
      trigger: input.trigger,
      action: input.action,
      sharing: { scope: "private" },
      isActive: input.isActive,
      deleteAfterSuccess: input.deleteAfterSuccess,
      agentNotification: { mode: "off" },
      nextRunAt: firstRunAt(input.trigger, NOW),
      revision: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    return { id, revision: 1 };
  });
  const change = (
    id: string,
    patch: Partial<Pick<StoredAutomation, "trigger" | "action" | "isActive" | "name">>,
  ): void => {
    const current = automations.get(id);
    if (!current) throw new AutomationError("not_found");
    const isActive = patch.isActive ?? current.isActive;
    const trigger = patch.trigger ?? current.trigger;
    automations.set(id, {
      ...current,
      ...patch,
      isActive,
      revision: current.revision + 1,
      nextRunAt: isActive ? firstRunAt(trigger, NOW) : null,
    });
  };
  const update = vi.fn(
    async (
      _userId: string,
      input: { automationId: string } & Partial<StoredAutomation>,
    ) => {
      const { automationId, trigger, action, isActive, name } = input;
      change(automationId, {
        ...(trigger ? { trigger } : {}),
        ...(action ? { action } : {}),
        ...(isActive === undefined ? {} : { isActive }),
        ...(name ? { name } : {}),
      });
    },
  );
  const setActive = vi.fn(
    async (_userId: string, input: { automationId: string; isActive: boolean }) =>
      change(input.automationId, { isActive: input.isActive }),
  );
  const remove = vi.fn(
    async (_userId: string, input: { automationId: string; confirmed: boolean }) => {
      if (!input.confirmed) throw new AutomationError("invalid_request");
      // The binding goes with its automation, as the foreign key does it.
      automations.delete(input.automationId);
      bindings.delete(input.automationId);
    },
  );
  const sameChat = (
    task: StoredAgentChatTask,
    chat: StoredAgentChatTaskChat,
  ): boolean =>
    JSON.stringify(task.chat) === JSON.stringify(chat);
  const members = new Map<string, readonly string[]>([
    ["group-1", ["igor", "maya", "agent", "agent-2"]],
  ]);
  const accounts = (userId: string): AutomationAccount | null => {
    const user = USERS.get(userId);
    return user
      ? {
          id: user.id,
          displayName: user.displayName,
          isAgent: user.isAgent === true,
          isActive: user.isActive,
          isAdministrator: false,
          isReadOnly: false,
          timeZone: "Europe/Berlin",
          language: "de",
        }
      : null;
  };
  const service = new AgentChatTaskService({
    automations: {
      create: create as never,
      update: update as never,
      setActive: setActive as never,
      delete: remove as never,
    },
    account: async (userId) => accounts(userId),
    stored: { find: async (id) => automations.get(id) ?? null },
    tasks: {
      insert: async (task) => {
        bindings.set(task.automationId, task);
      },
      find: async (id) => bindings.get(id) ?? null,
      listForChat: async (chat, agentId) =>
        [...bindings.values()].filter(
          (task) =>
            sameChat(task, chat) && (agentId === null || task.agentId === agentId),
        ),
      countForChat: async (chat) =>
        [...bindings.values()].filter((task) => sameChat(task, chat)).length,
      updateTexts: async (id, texts) => {
        const task = bindings.get(id);
        if (task) bindings.set(id, { ...task, ...texts });
      },
    },
    users: { findById: async (id) => USERS.get(id) ?? null },
    members: async (conversationId) => members.get(conversationId) ?? [],
    limit: async () => options.limit ?? 20,
    now: () => NOW,
  });
  return { service, automations, bindings, create, update, setActive, remove };
}
