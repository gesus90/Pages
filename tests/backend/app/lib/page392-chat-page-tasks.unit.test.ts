import { describe, expect, it, vi } from "vitest";

import {
  CHAT_TASK_STATUS,
  chatTaskFailure,
  isChatTaskIntent,
  runChatTaskIntent,
} from "@/app/lib/chat-page-tasks.server";
import { AgentChatTaskError } from "@/backend/error/AgentChatTaskError";
import { AgentChatSettingsService } from "@/backend/service/conversation/AgentChatSettingsService";

import type { AgentChatTaskService } from "@/backend/service/employee/AgentChatTaskService";
import type { AgentChatTaskView } from "@/definition/AgentChatTask";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";
import type { Mock } from "vitest";

const IGOR: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

const TASK: AgentChatTaskView = {
  id: "automation-1",
  agentId: "agent",
  agentName: "Agent",
  kind: "reminder",
  request: "Dentist",
  instruction: "Dentist",
  trigger: {
    type: "once",
    at: "2026-11-16T08:00:00.000Z",
    timeZone: "Europe/Berlin",
  },
  isActive: true,
  nextRunAt: "2026-11-16T08:00:00.000Z",
  requesterId: "igor",
  requesterName: "Igor",
  createdAt: "2026-11-15T12:00:00.000Z",
};

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

function service(): {
  readonly forChat: Mock<AgentChatTaskService["forChat"]>;
  readonly setActiveForPerson: Mock<AgentChatTaskService["setActiveForPerson"]>;
  readonly removeForPerson: Mock<AgentChatTaskService["removeForPerson"]>;
} {
  return {
    forChat: vi.fn<AgentChatTaskService["forChat"]>(async () => [TASK]),
    setActiveForPerson: vi.fn<AgentChatTaskService["setActiveForPerson"]>(
      async () => TASK,
    ),
    removeForPerson: vi.fn<AgentChatTaskService["removeForPerson"]>(
      async () => undefined,
    ),
  };
}

describe("PAGE-392 chat page: Geplante Aufgaben", () => {
  it("lists the tasks of a group and of the direct chat with an agent", async () => {
    const tasks = service();
    expect(isChatTaskIntent("chat-tasks")).toBe(true);
    expect(isChatTaskIntent("send")).toBe(false);
    await expect(
      runChatTaskIntent(
        tasks,
        IGOR,
        "chat-tasks",
        form({ conversationId: "group-1" }),
      ),
    ).resolves.toEqual({ chatTasks: [TASK] });
    expect(tasks.forChat).toHaveBeenCalledWith(IGOR, {
      kind: "group",
      conversationId: "group-1",
    });
    await runChatTaskIntent(
      tasks,
      IGOR,
      "chat-tasks",
      form({ agentId: "agent" }),
    );
    expect(tasks.forChat).toHaveBeenLastCalledWith(IGOR, {
      kind: "direct",
      agentId: "agent",
    });
  });

  it("pauses, resumes and deletes a task and answers the list as it is now", async () => {
    const tasks = service();
    await runChatTaskIntent(
      tasks,
      IGOR,
      "chat-task-active",
      form({
        conversationId: "group-1",
        taskId: "automation-1",
        isActive: "false",
      }),
    );
    expect(tasks.setActiveForPerson).toHaveBeenCalledWith(IGOR, {
      taskId: "automation-1",
      isActive: false,
    });
    await runChatTaskIntent(
      tasks,
      IGOR,
      "chat-task-active",
      form({ agentId: "agent", taskId: "automation-1", isActive: "true" }),
    );
    expect(tasks.setActiveForPerson).toHaveBeenLastCalledWith(IGOR, {
      taskId: "automation-1",
      isActive: true,
    });
    const answer = await runChatTaskIntent(
      tasks,
      IGOR,
      "chat-task-delete",
      form({ conversationId: "group-1", taskId: "automation-1" }),
    );
    expect(tasks.removeForPerson).toHaveBeenCalledWith(IGOR, "automation-1");
    expect(answer.chatTasks).toHaveLength(1);
  });

  it("refuses a request without a chat and maps refusals to their status", async () => {
    await expect(
      runChatTaskIntent(service(), IGOR, "chat-tasks", form({})),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(chatTaskFailure(new AgentChatTaskError("not_found"))).toBe(
      "not_found",
    );
    expect(chatTaskFailure(new Error("other"))).toBeNull();
    expect(CHAT_TASK_STATUS.not_found).toBe(404);
  });
});

describe("PAGE-392 limit of tasks per chat", () => {
  const admin: AccountAccess = {
    userId: "admin",
    role: null,
    isAdmin: true,
    mode: "admin",
    firstName: "Admin",
    lastName: "User",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: true,
    allProjects: true,
    hasHadDepartment: false,
  };

  it("saves the limit of tasks per chat within its range and keeps it when the form leaves it out", async () => {
    const save = vi.fn(async () => undefined);
    const read = vi.fn(async () => ({
      hourlyMessageLimit: 30,
      scheduledTaskLimit: 20,
      revision: 1,
    }));
    const settings = new AgentChatSettingsService({ read, save });
    vi.spyOn(
      await import("@/backend/service/agents/AgentServiceAccess"),
      "requireAgentAdministrator",
    ).mockImplementation(() => undefined);
    await settings.save(admin, {
      hourlyMessageLimit: 30,
      scheduledTaskLimit: 5,
      revision: 1,
    });
    expect(save).toHaveBeenCalledWith({
      hourlyMessageLimit: 30,
      scheduledTaskLimit: 5,
      revision: 1,
    });
    await settings.save(admin, { hourlyMessageLimit: 40, revision: 2 });
    expect(save).toHaveBeenLastCalledWith({
      hourlyMessageLimit: 40,
      scheduledTaskLimit: 20,
      revision: 2,
    });
    await expect(
      settings.save(admin, {
        hourlyMessageLimit: 30,
        scheduledTaskLimit: 0,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "profile_invalid" });
    await expect(settings.current()).resolves.toMatchObject({
      scheduledTaskLimit: 20,
    });
  });
});
