import { randomUUID } from "node:crypto";

import { AgentChatTaskError } from "@/backend/error/AgentChatTaskError";
import { AutomationError } from "@/backend/error/AutomationError";

import { chatTaskName, chatTaskPrompt } from "./AgentChatTaskPrompt";
import {
  AgentChatTaskScheduleError,
  chatTaskTrigger,
  describeChatTaskTrigger,
} from "./AgentChatTaskSchedule";

import type {
  StoredAgentChatTask,
  StoredAgentChatTaskChat,
  AgentChatTaskRepository,
} from "@/backend/database/repositories/conversation/AgentChatTaskRepository";
import type {
  AutomationRepository,
  StoredAutomation,
} from "@/backend/database/repositories/automation/AutomationRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { AutomationAccount } from "@/backend/service/automation/AutomationDirectory";
import type { AutomationService } from "@/backend/service/automation/AutomationService";
import type { AutomationTrigger } from "@/definition/Automation";
import type {
  AgentChatTaskChange,
  AgentChatTaskChat,
  AgentChatTaskReceipt,
  AgentChatTaskRequest,
  AgentChatTasks,
  AgentChatTaskView,
} from "@/definition/AgentChatTask";
import type { User } from "@/definition/User";

/** What the scheduled tasks of chats are built from. */
export interface AgentChatTaskDependencies {
  /** The automations behind the tasks; every change runs with the rights of the person who asked. */
  readonly automations: Pick<
    AutomationService,
    "create" | "update" | "setActive" | "delete"
  >;
  /** The account of a person as automations see it: time zone and language. */
  readonly account: (userId: string) => Promise<AutomationAccount | null>;
  readonly stored: Pick<AutomationRepository, "find">;
  readonly tasks: Pick<
    AgentChatTaskRepository,
    "insert" | "find" | "listForChat" | "countForChat" | "updateTexts"
  >;
  readonly users: Pick<UserRepository, "findById">;
  /** The members of a conversation; empty for one that does not exist. */
  readonly members: (conversationId: string) => Promise<readonly string[]>;
  /** How many tasks one chat may hold, as the instance sets it. */
  readonly limit: () => Promise<number>;
  readonly now?: () => Date;
}

/** The chat of the page whose tasks a person reads or changes. */
export type AgentChatTaskPageChat =
  | { readonly kind: "group"; readonly conversationId: string }
  | { readonly kind: "direct"; readonly agentId: string };

/** The binding of one job: its agent and its chat. */
interface JobChat {
  readonly agentId: string;
  readonly chat: AgentChatTaskChat;
}

function storedChatOf(chat: AgentChatTaskChat): StoredAgentChatTaskChat {
  return chat.kind === "direct"
    ? { kind: "direct", personId: chat.personId }
    : { kind: "group", conversationId: chat.conversationId };
}

function isSameChat(
  left: StoredAgentChatTaskChat,
  right: StoredAgentChatTaskChat,
): boolean {
  if (left.kind === "group" && right.kind === "group")
    return left.conversationId === right.conversationId;
  if (left.kind === "direct" && right.kind === "direct")
    return left.personId === right.personId;
  return false;
}

/** Translates a refusal of the automations into the code of a task. */
function translate(error: unknown): never {
  if (error instanceof AgentChatTaskScheduleError)
    throw new AgentChatTaskError(error.code);
  if (!(error instanceof AutomationError)) throw error;
  if (error.code === "forbidden") throw new AgentChatTaskError("forbidden");
  if (error.code === "not_found") throw new AgentChatTaskError("not_found");
  const { reason } = error;
  if (reason === "time_required") throw new AgentChatTaskError("time_in_past");
  if (reason === "run_active") throw new AgentChatTaskError("run_active");
  throw new AgentChatTaskError("invalid");
}

/**
 * The scheduled tasks of chat agents (PAGE-392): reminders and recurring
 * tasks an agent plans from a chat.
 *
 * @remarks
 * A task is an automation of the person who asked, with an agent action
 * whose instruction Pages composes, bound to the chat in
 * `agent_chat_tasks`. Times count in that person's time zone. Only a person
 * who may address the agent in the chat plans one: the person of the direct
 * chat, or the person who addressed the agent in a group they both belong
 * to. A chat holds at most the limit of the instance. The agent lists,
 * changes and deletes only its own tasks of its chat; the chat page shows
 * every task of the chat to its people, who may pause and delete them.
 */
export class AgentChatTaskService {
  private readonly dependencies: AgentChatTaskDependencies;

  public constructor(dependencies: AgentChatTaskDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The scheduled tasks of one job, bound to its agent and chat.
   *
   * @param agentId - The agent whose job runs.
   * @param chat - The chat of the job and who addressed the agent in it.
   */
  public bind(agentId: string, chat: AgentChatTaskChat): AgentChatTasks {
    const job: JobChat = { agentId, chat };
    return {
      create: (request) => this.create(job, request),
      list: () => this.list(job),
      update: (id, change) => this.update(job, id, change),
      remove: (id) => this.remove(job, id),
    };
  }

  /**
   * The tasks of a chat as the chat page lists them, of every agent.
   *
   * @throws {AgentChatTaskError} `not_found` for a chat the person is not in.
   */
  public async forChat(
    person: User,
    chat: AgentChatTaskPageChat,
  ): Promise<readonly AgentChatTaskView[]> {
    const target = await this.pageChat(person, chat);
    const agentId = chat.kind === "direct" ? chat.agentId : null;
    const tasks = await this.dependencies.tasks.listForChat(target, agentId);
    return this.views(tasks);
  }

  /**
   * Pauses or resumes a task from the chat page.
   *
   * @throws {AgentChatTaskError} `not_found` for a task outside the person's
   * chats, `time_in_past` for a once task whose time has passed.
   */
  public async setActiveForPerson(
    person: User,
    input: { readonly taskId: unknown; readonly isActive: unknown },
  ): Promise<AgentChatTaskView> {
    if (typeof input.isActive !== "boolean")
      throw new AgentChatTaskError("invalid");
    const task = await this.pageTask(person, input.taskId);
    const automation = await this.automationOf(task);
    try {
      await this.dependencies.automations.setActive(task.requesterId, {
        operationId: randomUUID(),
        automationId: task.automationId,
        expectedRevision: automation.revision,
        isActive: input.isActive,
      });
    } catch (error: unknown) {
      translate(error);
    }
    const [view] = await this.views([task]);
    if (!view) throw new AgentChatTaskError("not_found");
    return view;
  }

  /**
   * Deletes a task from the chat page.
   *
   * @throws {AgentChatTaskError} `not_found` for a task outside the person's
   * chats, `run_active` while it runs.
   */
  public async removeForPerson(person: User, taskId: unknown): Promise<void> {
    await this.delete(await this.pageTask(person, taskId));
  }

  private async create(
    job: JobChat,
    request: AgentChatTaskRequest,
  ): Promise<AgentChatTaskReceipt> {
    const requester = await this.requester(job);
    const chat = storedChatOf(job.chat);
    const { tasks, automations } = this.dependencies;
    const [count, limit] = await Promise.all([
      tasks.countForChat(chat),
      this.dependencies.limit(),
    ]);
    if (count >= limit) throw new AgentChatTaskError("limit_reached");
    const account = await this.requireAccount(requester.id);
    const now = this.now();
    let automationId: string;
    try {
      const trigger = chatTaskTrigger(request.schedule, {
        timeZone: account.timeZone,
        now,
      });
      const automation = await automations.create(requester.id, {
        operationId: randomUUID(),
        name: chatTaskName(request.request, account.language),
        trigger,
        action: this.action(job.agentId, request, account),
        isActive: true,
        deleteAfterSuccess: trigger.type === "once",
      });
      automationId = automation.id;
    } catch (error: unknown) {
      translate(error);
    }
    const stored: StoredAgentChatTask = {
      automationId,
      agentId: job.agentId,
      requesterId: requester.id,
      chat,
      kind: request.kind,
      request: request.request,
      instruction: request.instruction,
      createdAt: now.toISOString(),
    };
    await tasks.insert(stored);
    return this.receipt(stored);
  }

  private async list(job: JobChat): Promise<readonly AgentChatTaskReceipt[]> {
    const tasks = await this.dependencies.tasks.listForChat(
      storedChatOf(job.chat),
      job.agentId,
    );
    return Promise.all(tasks.map((task) => this.receipt(task)));
  }

  private async update(
    job: JobChat,
    id: string,
    change: AgentChatTaskChange,
  ): Promise<AgentChatTaskReceipt> {
    const task = await this.jobTask(job, id);
    const automation = await this.automationOf(task);
    const account = await this.requireAccount(task.requesterId);
    const texts = {
      request: change.request ?? task.request,
      instruction: change.instruction ?? task.instruction,
    };
    const hasTexts =
      change.request !== undefined || change.instruction !== undefined;
    try {
      await this.dependencies.automations.update(task.requesterId, {
        operationId: randomUUID(),
        automationId: task.automationId,
        expectedRevision: automation.revision,
        ...(change.schedule
          ? {
              trigger: chatTaskTrigger(change.schedule, {
                timeZone: account.timeZone,
                now: this.now(),
              }),
            }
          : {}),
        ...(change.isActive === undefined ? {} : { isActive: change.isActive }),
        ...(hasTexts
          ? {
              name: chatTaskName(texts.request, account.language),
              action: this.action(
                job.agentId,
                { kind: task.kind, ...texts },
                account,
              ),
            }
          : {}),
      });
    } catch (error: unknown) {
      translate(error);
    }
    if (hasTexts)
      await this.dependencies.tasks.updateTexts(task.automationId, texts);
    return this.receipt({ ...task, ...texts });
  }

  private async remove(job: JobChat, id: string): Promise<void> {
    await this.delete(await this.jobTask(job, id));
  }

  private async delete(task: StoredAgentChatTask): Promise<void> {
    const automation = await this.automationOf(task);
    try {
      // Deleting the automation removes its binding with it.
      await this.dependencies.automations.delete(task.requesterId, {
        operationId: randomUUID(),
        automationId: task.automationId,
        expectedRevision: automation.revision,
        confirmed: true,
      });
    } catch (error: unknown) {
      translate(error);
    }
  }

  /** The agent action of a task, with the instruction Pages composes. */
  private action(
    agentId: string,
    task: Pick<AgentChatTaskRequest, "kind" | "request" | "instruction">,
    account: AutomationAccount,
  ): { readonly type: "agent"; readonly agentId: string; readonly instruction: string } {
    return {
      type: "agent",
      agentId,
      instruction: chatTaskPrompt({
        kind: task.kind,
        request: task.request,
        instruction: task.instruction,
        requesterName: account.displayName,
        language: account.language,
      }),
    };
  }

  /**
   * The person a task of the job is planned for: the person of the direct
   * chat, or the person who addressed the agent in a group both belong to.
   */
  private async requester(job: JobChat): Promise<User> {
    const { chat } = job;
    const requesterId =
      chat.kind === "direct" ? chat.personId : chat.askerId;
    if (requesterId === null) throw new AgentChatTaskError("forbidden");
    const person = await this.dependencies.users.findById(requesterId);
    if (!person || person.isAgent === true || !person.isActive)
      throw new AgentChatTaskError("forbidden");
    if (chat.kind === "conversation") {
      const members = await this.dependencies.members(chat.conversationId);
      if (!members.includes(person.id) || !members.includes(job.agentId))
        throw new AgentChatTaskError("forbidden");
    }
    return person;
  }

  /** A task of the job's agent in the job's chat. */
  private async jobTask(job: JobChat, id: string): Promise<StoredAgentChatTask> {
    const task = await this.dependencies.tasks.find(id);
    if (
      !task ||
      task.agentId !== job.agentId ||
      !isSameChat(task.chat, storedChatOf(job.chat))
    )
      throw new AgentChatTaskError("not_found");
    return task;
  }

  /** The chat of the page, after checking that the person is in it. */
  private async pageChat(
    person: User,
    chat: AgentChatTaskPageChat,
  ): Promise<StoredAgentChatTaskChat> {
    if (person.isAgent === true) throw new AgentChatTaskError("not_found");
    if (chat.kind === "direct") return { kind: "direct", personId: person.id };
    const members = await this.dependencies.members(chat.conversationId);
    if (!members.includes(person.id)) throw new AgentChatTaskError("not_found");
    return { kind: "group", conversationId: chat.conversationId };
  }

  /** A task of a chat the person is in. */
  private async pageTask(
    person: User,
    taskId: unknown,
  ): Promise<StoredAgentChatTask> {
    if (typeof taskId !== "string" || taskId === "")
      throw new AgentChatTaskError("invalid");
    const task = await this.dependencies.tasks.find(taskId);
    if (!task) throw new AgentChatTaskError("not_found");
    await this.pageChat(
      person,
      task.chat.kind === "group"
        ? task.chat
        : { kind: "direct", agentId: task.agentId },
    );
    if (task.chat.kind === "direct" && task.chat.personId !== person.id)
      throw new AgentChatTaskError("not_found");
    return task;
  }

  private async automationOf(
    task: StoredAgentChatTask,
  ): Promise<StoredAutomation> {
    const automation = await this.dependencies.stored.find(task.automationId);
    if (!automation) throw new AgentChatTaskError("not_found");
    return automation;
  }

  private async requireAccount(userId: string): Promise<AutomationAccount> {
    const account = await this.dependencies.account(userId);
    if (!account?.isActive) throw new AgentChatTaskError("forbidden");
    return account;
  }

  private async receipt(
    task: StoredAgentChatTask,
  ): Promise<AgentChatTaskReceipt> {
    const [view] = await this.views([task]);
    if (!view) throw new AgentChatTaskError("not_found");
    const account = await this.dependencies.account(task.requesterId);
    return {
      task: view,
      when: this.describe(view.trigger, account?.language ?? "de"),
    };
  }

  private describe(trigger: AutomationTrigger, language: "de" | "en"): string {
    return describeChatTaskTrigger(trigger, { now: this.now(), language });
  }

  /** The views of stored tasks; a task whose automation is gone is left out. */
  private async views(
    tasks: readonly StoredAgentChatTask[],
  ): Promise<readonly AgentChatTaskView[]> {
    const names = new Map<string, string>();
    const nameOf = async (userId: string): Promise<string> => {
      const known = names.get(userId);
      if (known !== undefined) return known;
      const name =
        (await this.dependencies.users.findById(userId))?.displayName ?? "";
      names.set(userId, name);
      return name;
    };
    const views: AgentChatTaskView[] = [];
    for (const task of tasks) {
      const automation = await this.dependencies.stored.find(task.automationId);
      if (!automation) continue;
      views.push({
        id: task.automationId,
        agentId: task.agentId,
        agentName: await nameOf(task.agentId),
        kind: task.kind,
        request: task.request,
        instruction: task.instruction,
        trigger: automation.trigger,
        isActive: automation.isActive,
        nextRunAt: automation.isActive ? automation.nextRunAt : null,
        requesterId: task.requesterId,
        requesterName: await nameOf(task.requesterId),
        createdAt: task.createdAt,
      });
    }
    return views;
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
