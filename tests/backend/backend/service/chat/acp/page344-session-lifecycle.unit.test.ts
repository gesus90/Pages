import { expect, it, vi } from "vitest";

import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { employeeAcpRunner } from "@/backend/service/chat/acp/EmployeeAcpRunners";
import * as invocationFiles from "@/backend/service/chat/acp/PicaInvocationFile";

import { bareInstance } from "../../tasks/bare-instance";
import { ASSIGNMENT, FIRST, OWNER, SECOND } from "../page48-chat-fixture";
import { PicaJobWorld } from "./page103-job-fixture";

import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { ChatJob } from "@/definition/ChatJob";
import type { PicaAcpStart } from "@/backend/service/chat/acp/PicaAcpService";

// These boundaries must be mocked before importing the service that loads the real job.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
vi.mock("@/backend/service/chat/acp/PicaInvocationFile", () => ({
  writePicaInvocationFile: vi.fn(
    (directory: string) => `${directory}/.pica-synthetic/descriptor.json`,
  ),
  removePicaInvocationFile: vi.fn(),
  picaHelperPath: (file: string) => file.replace(/[^/]+$/u, "pica-helper"),
}));

function fixture(): {
  readonly service: PicaAcpService;
  readonly world: PicaJobWorld;
  readonly requests: ChatRequestRegistry;
  readonly pool: PicaAcpSessionPool;
  readonly jobs: Map<string, ChatJob>;
} {
  const world = new PicaJobWorld("claude_code");
  const jobs = new Map<string, ChatJob>();
  const repository = bareInstance(ChatJobRepository.prototype);
  vi.spyOn(repository, "interruptRunning").mockResolvedValue([]);
  vi.spyOn(repository, "create").mockImplementation(async (input) => {
    jobs.set(input.id, {
      id: input.id,
      sessionId: input.sessionId,
      state: "running",
      errorCode: null,
      createdAt: "today",
      endedAt: null,
      usage: { context: null, tokens: null, cost: null },
    });
  });
  vi.spyOn(repository, "find").mockImplementation(
    async (_userId, id) => jobs.get(id) ?? null,
  );
  vi.spyOn(repository, "append").mockImplementation(
    world.dependencies.jobs.append,
  );
  vi.spyOn(repository, "saveContext").mockResolvedValue();
  vi.spyOn(repository, "saveTurn").mockResolvedValue();
  vi.spyOn(repository, "finish").mockImplementation(
    async (id, state, errorCode) => {
      const current = jobs.get(id);
      if (current) jobs.set(id, { ...current, state, errorCode });
    },
  );
  const acpSessions = bareInstance(ChatAcpSessionRepository.prototype);
  vi.spyOn(acpSessions, "find").mockResolvedValue(null);
  vi.spyOn(acpSessions, "save").mockResolvedValue();
  const workspace = new PicaAcpWorkspace("/synthetic");
  vi.spyOn(workspace, "prepare").mockResolvedValue("/synthetic/fixed-chat");
  const steers = bareInstance(ChatSteerRepository.prototype);
  vi.spyOn(steers, "select").mockImplementation(
    world.dependencies.steers.select,
  );
  const requests = new ChatRequestRegistry();
  const pool = new PicaAcpSessionPool({ idleMinutes: async () => 10 });
  const service = new PicaAcpService({
    ...world.dependencies,
    jobs: repository,
    acpSessions,
    workspace,
    steers,
    requests,
    pool,
    sessions: {
      ...world.dependencies.sessions,
      require: vi.fn<ChatSessionService["require"]>(async (_actor, id) => {
        if (typeof id !== "string") throw new Error("Missing session ID");
        return { id, createdAt: "today", lastMessageAt: "today", preview: "" };
      }),
    },
    attachments: {
      ...world.dependencies.attachments,
      pending: async () => [],
      link: async () => undefined,
    },
  });
  return { service, world, requests, pool, jobs };
}

function input(revision = 1): PicaAcpStart {
  const agent = {
    ...ASSIGNMENT,
    connection: {
      ...ASSIGNMENT.connection,
      provider: "claude_code",
      cliLoggedInAt: "2026-11-13",
    },
  } as const;
  return {
    actor: OWNER,
    agent,
    request: {
      sessionId: FIRST,
      clientMessageId: null,
      text: "Question",
      attachmentIds: [],
    },
    brief: {
      instructions: "Synthetic",
      prompt: {
        personName: "Owner",
        interfaceLanguage: "de",
        today: "2026-11-13",
        history: [],
      },
    },
    employee: {
      runner: employeeAcpRunner(agent, "pages"),
      requireCurrent: vi.fn(async () => undefined),
      requireConnection: vi.fn(async () => undefined),
      searchMemory: vi.fn(async () => []),
      keptSession: { conversation: "Group", revision },
    },
  };
}

it("PAGE-344 keeps one actual pooled session across settings revisions and changing helper paths", async () => {
  const { service, world, pool, jobs } = fixture();
  let descriptor = 0;
  const files = vi
    .spyOn(invocationFiles, "writePicaInvocationFile")
    .mockImplementation(
      (workspace) => `${workspace}/.pica-${++descriptor}/descriptor.json`,
    );
  const first = await service.start(input(1));
  await vi.waitFor(() => expect(world.opened).toHaveBeenCalledOnce());
  world.complete();
  await service.settled(OWNER, FIRST);
  const second = await service.start(input(2));
  await service.settled(OWNER, FIRST);
  expect(jobs.get(first.job.id)?.state).toBe("completed");
  expect(jobs.get(second.job.id)?.state).toBe("completed");
  expect(files).toHaveBeenCalledTimes(2);
  expect(world.opened).toHaveBeenCalledOnce();
  expect(world.close).not.toHaveBeenCalled();
  expect(
    world.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.content),
  ).toEqual(["Answer", "Follow-up answer"]);
  await pool.closeAll();
});

it.each(["model", "access", "credential"] as const)(
  "PAGE-344 applies a %s change on the affected agent's next round",
  async (kind) => {
    const { service, world, pool } = fixture();
    await service.start(input());
    await vi.waitFor(() => expect(world.opened).toHaveBeenCalledOnce());
    expect(world.close).not.toHaveBeenCalled();
    world.complete();
    await service.settled(OWNER, FIRST);
    const otherActor = { ...OWNER, id: "other-agent" };
    const other = input();
    await service.start({
      ...other,
      actor: otherActor,
      request: { ...other.request, sessionId: SECOND },
    });
    await service.settled(otherActor, SECOND);
    let changed = input(2);
    const employee = changed.employee;
    if (!employee) throw new Error("Missing employee");
    if (kind === "model")
      changed = { ...changed, agent: { ...changed.agent, model: "new-model" } };
    if (kind === "credential")
      changed = {
        ...changed,
        agent: {
          ...changed.agent,
          connection: {
            ...changed.agent.connection,
            cliLoggedInAt: "new-login",
          },
        },
      };
    if (kind === "access")
      changed = {
        ...changed,
        employee: {
          ...employee,
          runner: employeeAcpRunner(changed.agent, "yolo"),
        },
      };
    await service.start(changed);
    await service.settled(OWNER, FIRST);
    expect(world.opened).toHaveBeenCalledTimes(3);
    expect(world.close).toHaveBeenCalledOnce();
    await service.start({
      ...other,
      actor: otherActor,
      request: { ...other.request, sessionId: SECOND },
    });
    await service.settled(otherActor, SECOND);
    expect(world.opened).toHaveBeenCalledTimes(3);
    expect(pool.describe()).toHaveLength(2);
    await pool.closeAll();
  },
);

it("PAGE-344 preserves a complete employee answer during the settings stop handler", async () => {
  const { service, world, requests, pool, jobs } = fixture();
  const started = await service.start(input());
  await vi.waitFor(() => expect(world.opened).toHaveBeenCalledOnce());
  await Promise.all([service.stopAll(), requests.cancelAll()]);
  expect(jobs.get(started.job.id)?.state).toBe("running");
  expect(world.close).not.toHaveBeenCalled();
  world.text("Full answer in progress");
  world.complete();
  await service.settled(OWNER, FIRST);
  expect(jobs.get(started.job.id)).toMatchObject({
    state: "completed",
    errorCode: null,
  });
  expect(world.messages.at(-1)).toMatchObject({
    role: "assistant",
    content: "Answer",
  });
  await pool.closeAll();
});
