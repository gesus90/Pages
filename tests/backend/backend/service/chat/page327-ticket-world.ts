import { vi } from "vitest";

import { Database } from "@/backend/database/Database";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { PicaIdentityService } from "@/backend/service/chat/PicaIdentityService";
import { PicaTicketLifecycleService } from "@/backend/service/chat/PicaTicketLifecycleService";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";

import { bareInstance } from "../tasks/bare-instance";
import { isTicketVisible, presentTicket } from "../tasks/task-ticket-store";
import { TaskWorld } from "../tasks/task-world";

import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type { UserService } from "@/backend/service/UserService";

/** Native Pica calls on real services with repository and attachment boundaries in memory. */
export interface PicaTicketWorld {
  readonly storage: TaskWorld;
  readonly registry: RuntimeToolRegistry;
  readonly executor: ChatToolExecutor;
  readonly lifecycle: PicaTicketLifecycleService;
  readonly call: (
    tool: string,
    parameters: unknown,
    userId?: string,
  ) => Promise<PicaToolOutcome>;
}

function installDirectory(storage: TaskWorld): Pick<UserService, "getById"> {
  const users = {
    getById: vi.fn(
      async (id: string) =>
        storage.state.people.find((person) => person.id === id) ?? null,
    ),
  };
  vi.spyOn(UserRepository.prototype, "findById").mockImplementation(
    users.getById,
  );
  vi.spyOn(UserGroupRepository.prototype, "findAll").mockResolvedValue([]);
  vi.spyOn(TaskAttachmentService.prototype, "list").mockResolvedValue([]);
  // The production lookup includes archived keys, unlike TaskWorld's active-only default stub.
  vi.spyOn(TaskRepository.prototype, "findByKey").mockImplementation(
    async (key, visibility) => {
      const stored = [...storage.state.tickets.values()].find(
        (ticket) => ticket.key === key,
      );
      return stored && isTicketVisible(stored, visibility)
        ? presentTicket(storage.state, stored, visibility)
        : null;
    },
  );
  return users;
}

function createExecutor(
  storage: TaskWorld,
  users: Pick<UserService, "getById">,
  lifecycle: PicaTicketLifecycleService,
): ChatToolExecutor {
  const database = bareInstance(Database.prototype);
  vi.spyOn(database, "query").mockRejectedValue(
    new Error("Unexpected database query"),
  );
  const router = new AgentOperationRouter({
    channel: "chat",
    projects: storage.projects.repository,
    wiki: bareInstance(WikiRepository.prototype),
    users,
    planning: createAgentPlanningServices({
      channel: "chat",
      database,
      users,
      cache: storage.projects.cache,
      publisher: null,
      events: bareInstance(PagesEventPublisher.prototype),
    }),
  });
  const identities = new PicaIdentityService(users, {
    getContext: async (id) => {
      const account = storage.projects.state.accounts.get(id);
      if (!account) throw new Error("Unknown synthetic account");
      return account;
    },
  });
  return new ChatToolExecutor({
    router,
    identities,
    ticketLifecycle: lifecycle,
  });
}

/** Builds a Done task and subtask under an active epic, with current account and project policy. */
export function createPicaTicketWorld(): PicaTicketWorld {
  const storage = new TaskWorld();
  storage.addHierarchy();
  for (const [index, id] of ["ini", "epic", "task", "sub"].entries())
    storage.addTicket(id, { ...storage.ticket(id), number: index + 1 });
  for (const id of ["task", "sub"])
    storage.addTicket(id, { ...storage.ticket(id), statusId: "done" });
  const users = installDirectory(storage);
  const lifecycle = new PicaTicketLifecycleService({
    tasks: storage.tasks,
    projects: storage.projects.service,
    users,
    templates: bareInstance(TaskTemplateService.prototype),
    attachments: bareInstance(TaskAttachmentService.prototype),
  });
  const executor = createExecutor(storage, users, lifecycle);
  const registry = createPicaTools({
    tools: executor,
    sessions: { confirmationWord: async () => "LÖSCHEN" },
    authorize: async () => undefined,
  });
  const call = async (
    tool: string,
    parameters: unknown,
    userId = "manager",
  ): Promise<PicaToolOutcome> => {
    const invocation = await registry.invoke(tool, parameters, {
      userId,
      sessionId: "session",
      runId: "run",
      signal: new AbortController().signal,
      authorize: async () => undefined,
    });
    if (!invocation?.isValid) throw new Error("Invalid synthetic tool call");
    return PICA_TOOL_OUTCOME.parse(invocation.output);
  };
  return { storage, registry, executor, lifecycle, call };
}
