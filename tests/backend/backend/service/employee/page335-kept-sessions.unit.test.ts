import { expect, it, vi } from "vitest";

import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";

import { deferred } from "../agents/page81-resource-fixture";

import type { AgentEmployeeSessionDependencies } from "@/backend/service/employee/AgentEmployeeSessions";
import type { PicaAcpStart } from "@/backend/service/chat/acp/PicaAcpService";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...person,
  id: "agent",
  displayName: "Ed",
  isAgent: true,
};
const employee = { revision: 7, access: "pages", connectionId: "connection" };

function fixture(): {
  readonly service: AgentEmployeeSessions;
  readonly start: ReturnType<
    typeof vi.fn<(input: PicaAcpStart) => Promise<unknown>>
  >;
  readonly currentEmployee: ReturnType<typeof vi.fn>;
  readonly users: { findById: ReturnType<typeof vi.fn> };
  readonly settled: ReturnType<typeof vi.fn<() => Promise<undefined>>>;
} {
  const start = vi.fn<(input: PicaAcpStart) => Promise<unknown>>(async () => ({
    job: { id: "job" },
    messageId: "message",
  }));
  const settled = vi.fn<() => Promise<undefined>>(async () => undefined);
  const currentEmployee = vi.fn().mockResolvedValue(employee);
  const users = { findById: vi.fn().mockResolvedValue(agent) };
  const dependencies = {
    users,
    store: {
      employees: () => ({ find: currentEmployee }),
      conversations: () => ({
        ensure: vi.fn(async () => ({ sessionId: "chat-session" })),
      }),
    },
    acp: { start, settled, steer: vi.fn(async () => null) },
    createSessionId: () => "new-session",
  };
  const service = new AgentEmployeeSessions(
    dependencies as unknown as AgentEmployeeSessionDependencies,
  );
  // The resolution of model and brief is not part of this behavior.
  Reflect.set(service, "assignment", async () => ({
    connection: { id: "connection", provider: "claude_code" },
    model: "model",
    reasoningEffort: null,
    run: { access: "read_only", timeoutSeconds: 0 },
  }));
  Reflect.set(service, "brief", async () => ({
    brief: { instructions: "", prompt: {} },
    audience: { agentId: agent.id, chat: null, people: [] },
  }));
  return { service, start, settled, currentEmployee, users };
}

function round(
  purpose: "chat" | "conversation" | "learning",
): Parameters<AgentEmployeeSessions["run"]>[0] {
  const request: unknown = {
    agent,
    employee,
    person,
    purpose,
    conversationId: purpose === "conversation" ? "group-1" : undefined,
    conversationLabel:
      purpose === "conversation" ? "Gruppe „A-Team“" : undefined,
    text: "Hallo",
    clientMessageId: null,
  };
  return request as Parameters<AgentEmployeeSessions["run"]>[0];
}

it("runs two simultaneous rounds of one agent in one group one after another in its kept session", async () => {
  const { service, start, settled } = fixture();
  const firstDone = deferred<undefined>();
  start
    .mockImplementationOnce(async () => ({ job: { id: "job-1" } }))
    .mockImplementationOnce(async () => {
      throw new AgentExecutionError("requestBusy");
    })
    .mockImplementationOnce(async () => ({ job: { id: "job-2" } }));
  settled.mockImplementationOnce(() => firstDone.promise);
  const first = service.run(round("conversation"));
  const second = service.run(round("conversation"));
  await expect(first).resolves.toMatchObject({ sessionId: "chat-session" });
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
  // The second round starts only after the first released its session.
  expect(start).toHaveBeenCalledTimes(2);
  firstDone.resolve(undefined);
  await expect(second).resolves.toMatchObject({ sessionId: "chat-session" });
  expect(start).toHaveBeenCalledTimes(3);
  for (const [input] of start.mock.calls)
    expect(input).toMatchObject({
      request: { sessionId: "chat-session" },
      employee: {
        keptSession: { conversation: "Gruppe „A-Team“", revision: 7 },
      },
    });
});

it("keeps the session of a direct chat and none for a run of the agent's own", async () => {
  const { service, start } = fixture();
  await service.run(round("chat"));
  await service.run(round("learning"));
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    employee: { keptSession: { conversation: "Chat mit Person", revision: 7 } },
  });
  const learning: unknown = start.mock.calls[1]?.[0];
  expect(JSON.stringify(learning)).not.toContain("keptSession");
});

it("PAGE-344 finishes a running answer after settings save but still enforces account deactivation", async () => {
  const { service, start, currentEmployee, users } = fixture();
  start.mockImplementationOnce(async (input) => {
    const requireCurrent = input.employee?.requireCurrent;
    if (!requireCurrent) throw new Error("Missing authorization");
    await requireCurrent();
    currentEmployee.mockResolvedValue({
      ...employee,
      revision: 8,
      model: "next-model",
      access: "yolo",
    });
    await expect(requireCurrent()).resolves.toBeUndefined();
    users.findById.mockResolvedValue({ ...agent, isActive: false });
    await expect(requireCurrent()).rejects.toMatchObject({
      code: "accessDenied",
    });
    users.findById.mockResolvedValue(agent);
    return { job: { id: "complete-job" } };
  });
  await expect(service.run(round("conversation"))).resolves.toMatchObject({
    start: { job: { id: "complete-job" } },
  });
});
