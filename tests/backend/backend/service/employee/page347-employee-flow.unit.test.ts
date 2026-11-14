import { expect, it, vi } from "vitest";

import { AGENT_DREAM_DEFAULT_SCHEDULE } from "@/definition/AgentDreaming";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AccountIdentityRepository } from "@/backend/database/repositories/employee/AccountIdentityRepository";
import { AgentConversationRepository } from "@/backend/database/repositories/employee/AgentConversationRepository";
import { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import { AgentAccessEnvironmentService } from "@/backend/service/employee/AgentAccessEnvironmentService";
import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";
import { AgentChatContext } from "@/backend/service/employee/AgentChatContext";
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";

import { bareInstance } from "../tasks/bare-instance";
import { ACTOR, modelWorld, ZEN } from "./page347-model-fixture";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

function inputFor(access: AgentEmployeeAccess): AgentEmployeeInput {
  return {
    username: "zen-agent",
    displayName: "Zen Agent",
    position: null,
    avatarColor: null,
    roleId: "role",
    departments: [],
    settings: {
      connectionId: "connection",
      model: ZEN.id,
      reasoningEffort: null,
      access,
    },
    documents: { soul: "Synthetic", instructions: "" },
    memory: null,
    dream: null,
    isLearningEnabled: false,
    voice: { voiceId: null, speedTenths: 10 },
    limits: { memoryCharacters: 5000, dreamCharacters: 5000 },
  };
}

function persistence(): {
  readonly authorization: AuthorizationRepository;
  readonly store: EmployeeStore;
  readonly employees: AgentEmployeeRepository;
} {
  const authorization = bareInstance(AuthorizationRepository.prototype);
  const store = bareInstance(EmployeeStore.prototype);
  const employees = bareInstance(AgentEmployeeRepository.prototype);
  const identities = bareInstance(AccountIdentityRepository.prototype);
  const conversations = bareInstance(AgentConversationRepository.prototype);
  vi.spyOn(authorization, "transaction").mockImplementation(async (work) =>
    work(authorization),
  );
  vi.spyOn(authorization, "snapshot").mockResolvedValue({
    accounts: [ACTOR],
    roles: [
      {
        id: "role",
        name: "Worker",
        rank: 1,
        permissions: [],
        departmentBound: false,
      },
    ],
    departments: [],
  });
  vi.spyOn(authorization, "saveAccount").mockResolvedValue();
  vi.spyOn(authorization, "employees").mockReturnValue(store);
  vi.spyOn(store, "employees").mockReturnValue(employees);
  vi.spyOn(store, "identities").mockReturnValue(identities);
  vi.spyOn(store, "conversations").mockReturnValue(conversations);
  vi.spyOn(identities, "insertAgent").mockResolvedValue();
  vi.spyOn(identities, "jobTitles").mockResolvedValue(new Map());
  vi.spyOn(conversations, "ensure").mockImplementation(
    async (target, sessionId) => ({ ...target, sessionId }),
  );
  vi.spyOn(employees, "create").mockResolvedValue();
  return { authorization, store, employees };
}

function flowWorld(): {
  readonly administration: AgentEmployeeAdministration;
  readonly sessions: AgentEmployeeSessions;
  readonly employees: AgentEmployeeRepository;
  readonly acp: PicaAcpService;
} {
  const { models } = modelWorld();
  const { authorization, store, employees } = persistence();
  const memory = bareInstance(AgentMemoryService.prototype);
  const activity = bareInstance(AgentActivityService.prototype);
  const accessEnvironment = bareInstance(
    AgentAccessEnvironmentService.prototype,
  );
  vi.spyOn(memory, "initialize").mockResolvedValue();
  vi.spyOn(activity, "recordAccessChange").mockResolvedValue();
  vi.spyOn(accessEnvironment, "isIsolationAvailable").mockResolvedValue(true);
  vi.spyOn(accessEnvironment, "chatServers").mockResolvedValue([]);
  const administration = new AgentEmployeeAdministration({
    authorization,
    models,
    memory,
    activity,
    accessEnvironment,
    cache: {
      invalidateUsers: vi.fn(),
      invalidateProjectMembership: vi.fn(),
      invalidateWorkItems: vi.fn(),
    },
  });
  const acp = bareInstance(PicaAcpService.prototype);
  vi.spyOn(acp, "steer").mockResolvedValue(null);
  vi.spyOn(acp, "start").mockResolvedValue({
    messageId: "message",
    job: {
      id: "job",
      sessionId: "session",
      state: "running",
      errorCode: null,
      createdAt: "today",
      endedAt: null,
      usage: { context: null, cost: null, tokens: null },
    },
  });
  vi.spyOn(AgentChatContext.prototype, "forJob").mockResolvedValue({
    audience: { agentId: "agent", chat: null, people: [] },
    memory: "",
    dream: "",
    related: [],
    history: [],
    summary: null,
    isChat: true,
  });
  const sessions = new AgentEmployeeSessions({
    store,
    authorization,
    models,
    memory,
    accessEnvironment,
    acp,
    users: { findById: async () => null },
    messages: { messages: async () => [] },
    languages: { findByUserId: async () => null },
    createSessionId: () => "session",
  });
  return { administration, sessions, employees, acp };
}

function employeeFor(
  userId: string,
  input: AgentEmployeeInput,
): StoredAgentEmployee {
  return {
    ...input.settings,
    userId,
    soul: input.documents.soul,
    instructions: "",
    memory: "",
    dream: "",
    dreamSchedule: AGENT_DREAM_DEFAULT_SCHEDULE,
    dreamRequest: null,
    isLearningEnabled: false,
    learningIntervalHours: 24,
    learnedThrough: null,
    lastLearningAt: null,
    lastLearningResult: null,
    revision: 1,
    createdAt: "today",
    updatedAt: "today",
    voiceId: null,
    voiceSpeedTenths: 10,
    memoryCharacters: 5000,
    dreamCharacters: 5000,
  };
}

it.each(["workspace", "yolo"] as const)(
  "saves and starts free Zen in direct and group chats with %s access",
  async (access) => {
    const { administration, sessions, employees, acp } = flowWorld();
    const input = inputFor(access);
    const id = await administration.create("admin", input, null);
    expect(employees.create).toHaveBeenCalledWith(
      id,
      expect.objectContaining(input.settings),
    );
    const agent: User = {
      id,
      username: "zen-agent",
      displayName: "Zen Agent",
      isAgent: true,
      isActive: true,
      role: "employee",
      mustChangePassword: false,
    };
    for (const purpose of ["chat", "conversation"] as const) {
      await expect(
        sessions.run({
          agent,
          employee: employeeFor(id, input),
          person: null,
          purpose,
          ...(purpose === "conversation" ? { conversationId: "group" } : {}),
          text: "Synthetic request",
          clientMessageId: null,
        }),
      ).resolves.toMatchObject({ sessionId: "session" });
    }
    expect(acp.start).toHaveBeenCalledTimes(2);
    const call = vi.mocked(acp.start).mock.lastCall;
    expect(call?.[0].agent?.model).toBe(ZEN.id);
    expect(call?.[0].agent?.run?.access).toBe("yolo");
    expect(call?.[0].employee?.runner.provider).toBe("opencode");
    expect(call?.[0].employee?.runner.hasBridgeMcp).toBe(true);
  },
);

it("rejects a forged read-only Zen save before any persistence write", async () => {
  const { administration, employees } = flowWorld();
  await expect(
    administration.create("admin", inputFor("read_only"), null),
  ).rejects.toMatchObject({ code: "modelNotAllowed" });
  expect(employees.create).not.toHaveBeenCalled();
});
