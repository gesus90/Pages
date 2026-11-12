import { expect, it, vi } from "vitest";

import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";

import type { AgentEmployeeSessionDependencies } from "@/backend/service/employee/AgentEmployeeSessions";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = { ...person, id: "agent", isAgent: true };

function fixture(): {
  service: AgentEmployeeSessions;
  users: { findById: ReturnType<typeof vi.fn> };
  employees: { find: ReturnType<typeof vi.fn> };
  conversations: {
    find: ReturnType<typeof vi.fn>;
    ensure: ReturnType<typeof vi.fn>;
  };
  acp: Record<
    | "start"
    | "steer"
    | "update"
    | "stop"
    | "cancelTool"
    | "journals"
    | "settled"
    | "activity",
    ReturnType<typeof vi.fn>
  >;
} {
  const users = { findById: vi.fn().mockResolvedValue(agent) };
  const employees = { find: vi.fn().mockResolvedValue({ revision: 1 }) };
  const conversations = {
    find: vi.fn().mockResolvedValue({ sessionId: "session" }),
    ensure: vi.fn().mockResolvedValue({ sessionId: "session" }),
  };
  const acp = {
    start: vi.fn(),
    steer: vi.fn().mockResolvedValue({ id: "steer" }),
    update: vi.fn(),
    stop: vi.fn(),
    cancelTool: vi.fn().mockResolvedValue(true),
    journals: vi.fn().mockResolvedValue([]),
    settled: vi.fn(),
    activity: vi.fn(),
  };
  const dependencies = {
    users,
    store: { employees: () => employees, conversations: () => conversations },
    acp,
    createSessionId: () => "new-session",
  };
  return {
    service: new AgentEmployeeSessions(
      dependencies as unknown as AgentEmployeeSessionDependencies,
    ),
    users,
    employees,
    conversations,
    acp,
  };
}

it("validates messages and agent state before starting work", async () => {
  const { service, users, employees, acp } = fixture();
  for (const input of [
    null,
    {},
    { agentId: "bad id", text: "hello" },
    { agentId: "agent", text: "  " },
    { agentId: "agent", text: 1 },
  ]) {
    await expect(service.send(person, input)).rejects.toMatchObject({
      code: "invalidInput",
    });
  }
  users.findById.mockResolvedValueOnce(null);
  await expect(
    service.send(person, { agentId: "agent", text: "hello" }),
  ).rejects.toMatchObject({ code: "notFound" });
  users.findById.mockResolvedValueOnce({ ...agent, isActive: false });
  await expect(
    service.send(person, { agentId: "agent", text: "hello" }),
  ).rejects.toMatchObject({ code: "inactive" });
  employees.find.mockResolvedValueOnce(null);
  await expect(
    service.send(person, { agentId: "agent", text: "hello" }),
  ).rejects.toMatchObject({ code: "notFound" });
  expect(acp.steer).not.toHaveBeenCalled();
});

it("trims a message and steers it into the existing conversation", async () => {
  const { service, conversations, acp } = fixture();
  await service.send(person, {
    agentId: "agent",
    text: "  hello  ",
    clientMessageId: "message-1",
  });
  expect(conversations.ensure).toHaveBeenCalledWith(
    { agentId: "agent", personId: "person", purpose: "chat" },
    "new-session",
  );
  expect(acp.steer).toHaveBeenCalledWith(agent, {
    sessionId: "session",
    text: "hello",
    clientMessageId: "message-1",
    attachmentIds: [],
  });
  expect(acp.start).not.toHaveBeenCalled();
  expect(service.queuedMessages("agent", "person")).toEqual([]);
});

it("stops or cancels only the person's existing agent conversation", async () => {
  const { service, users, conversations, acp } = fixture();
  await expect(service.stop(person, "bad id")).rejects.toMatchObject({
    code: "invalidInput",
  });
  await expect(service.cancelTool(person, null)).rejects.toMatchObject({
    code: "invalidInput",
  });
  await service.stop(person, "agent");
  expect(acp.stop).toHaveBeenCalledWith(agent, "session");
  await expect(service.cancelTool(person, "agent")).resolves.toBe(true);
  expect(acp.cancelTool).toHaveBeenCalledWith(agent, "session");
  conversations.find.mockResolvedValueOnce(null);
  await expect(service.cancelTool(person, "agent")).resolves.toBe(false);
  users.findById.mockResolvedValueOnce(person);
  await service.stop(person, "person");
  expect(acp.stop).toHaveBeenCalledTimes(1);
  await service.stopSession(agent, "other");
  expect(acp.stop).toHaveBeenLastCalledWith(agent, "other");
});

it("reads running work, waiting steers, jobs and tool journals", async () => {
  const { service, acp } = fixture();
  acp.activity
    .mockResolvedValueOnce({
      job: { state: "running" },
      steers: [
        { status: "pending", messageId: "one" },
        { status: "delivered", messageId: "two" },
        { status: "followUp", messageId: "three" },
        { status: "consumed", messageId: "four" },
      ],
    })
    .mockResolvedValueOnce({ job: { state: "completed" }, steers: [] });
  await expect(service.waitingInJob(agent, "session")).resolves.toEqual(
    new Set(["one", "two", "three"]),
  );
  await expect(service.waitingInJob(agent, "session")).resolves.toEqual(
    new Set(),
  );
  acp.update
    .mockResolvedValueOnce({ job: { state: "running" } })
    .mockResolvedValueOnce({ job: { id: "job", state: "completed" } });
  await expect(service.isWorking(agent, "session")).resolves.toBe(true);
  await expect(
    service.isWorking({ ...agent, isActive: false }, "session"),
  ).resolves.toBe(false);
  await expect(service.job(agent, "session", "job")).resolves.toEqual({
    id: "job",
    state: "completed",
  });
  await expect(service.toolCalls(agent, "session")).resolves.toEqual({
    byMessage: {},
    current: [],
  });
  expect(acp.journals).toHaveBeenCalledWith(agent, "session", {
    jobs: 20,
    entries: 2000,
  });
});

it("translates a busy steer and preserves unexpected failures", async () => {
  const { service, acp } = fixture();
  acp.steer.mockRejectedValueOnce(new AgentExecutionError("requestBusy"));
  await expect(
    service.send(person, { agentId: "agent", text: "hello" }),
  ).rejects.toMatchObject({ code: "busy" });
  const failure = new Error("unexpected");
  acp.steer.mockRejectedValueOnce(failure);
  await expect(
    service.send(person, { agentId: "agent", text: "hello" }),
  ).rejects.toBe(failure);
});
