import { beforeEach, expect, it, vi } from "vitest";

import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { picaAcpRunner } from "@/backend/service/chat/acp/PicaAcpRunners";

import { environmentFiles as files } from "../../agents/page352-files";
import { ASSIGNMENT, FIRST, OWNER } from "../page48-chat-fixture";
import { completedTurn, PicaJobWorld } from "./page103-job-fixture";

import type { ChatAcpSession } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { PicaAcpStart } from "@/backend/service/chat/acp/PicaAcpService";
import type { ChatJob } from "@/definition/ChatJob";

vi.mock("@/backend/service/chat/acp/PicaInvocationFile", () => ({
  writePicaInvocationFile: (workspace: string) =>
    `${workspace}/.pica-synthetic/invocation.json`,
  removePicaInvocationFile: () => undefined,
  picaHelperPath: (file: string) => file.replace(/[^/]+$/u, "pages-pica"),
}));
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("../../agents/page352-files");
  return environmentFiles.module();
});
beforeEach(() => files.reset());

function createRepositories(): {
  jobs: ChatJobRepository;
  steers: ChatSteerRepository;
  sessions: ChatAcpSessionRepository;
  saved: () => ChatAcpSession | null;
} {
  const database = { query: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
  const jobs = new ChatJobRepository(database);
  const steers = new ChatSteerRepository(database);
  const sessions = new ChatAcpSessionRepository(database);
  let saved: ChatAcpSession | null = null;
  vi.spyOn(sessions, "find").mockImplementation(async () => saved);
  vi.spyOn(sessions, "save").mockImplementation(async (session) => {
    saved = session;
  });
  vi.spyOn(jobs, "interruptRunning").mockResolvedValue([]);
  vi.spyOn(jobs, "create").mockResolvedValue(undefined);
  vi.spyOn(jobs, "find").mockImplementation(
    async (userId, id): Promise<ChatJob> => ({
      id,
      sessionId: FIRST,
      state: "running",
      errorCode: null,
      createdAt: "2026-11-13",
      endedAt: null,
      usage: { context: null, tokens: null, cost: null },
    }),
  );
  vi.spyOn(jobs, "append").mockResolvedValue(undefined);
  vi.spyOn(jobs, "saveContext").mockResolvedValue(undefined);
  vi.spyOn(jobs, "saveTurn").mockResolvedValue(undefined);
  vi.spyOn(jobs, "finish").mockResolvedValue(undefined);
  vi.spyOn(steers, "update").mockResolvedValue(undefined);
  vi.spyOn(steers, "select").mockResolvedValue(undefined);
  vi.spyOn(steers, "answer").mockResolvedValue(undefined);
  return { jobs, steers, sessions, saved: () => saved };
}

function createInput(
  isEmployee: boolean,
  consume: (answer: string) => Promise<void>,
): PicaAcpStart {
  const agent = {
    ...ASSIGNMENT,
    connection: { ...ASSIGNMENT.connection, provider: "claude_code" as const },
  };
  const runner = picaAcpRunner(agent);
  return {
    actor: OWNER,
    agent,
    request: {
      clientMessageId: null,
      sessionId: FIRST,
      text: "Question",
      attachmentIds: [],
    },
    brief: {
      instructions: "Test",
      prompt: {
        personName: "Owner",
        interfaceLanguage: "de",
        today: "2026-11-13",
        history: [],
      },
    },
    ...(isEmployee
      ? {
          employee: {
            runner,
            requireCurrent: async () => undefined,
            requireConnection: async () => undefined,
            searchMemory: async () => [],
            consumeAnswer: consume,
          },
        }
      : {}),
  };
}

it.each([false, true])(
  "cleans a finished Pica/employee job (employee=%s) and resumes the same chat in an empty workspace",
  async (isEmployee) => {
    const world = new PicaJobWorld("claude_code");
    const repositories = createRepositories();
    const { jobs, steers, sessions } = repositories;
    const workspace = new PicaAcpWorkspace("/memory/pica-sessions");
    const requests = new ChatRequestRegistry();
    const service = new PicaAcpService({
      ...world.dependencies,
      jobs,
      steers,
      acpSessions: sessions,
      workspace,
      requests,
      attachments: {
        ...world.dependencies.attachments,
        pending: async () => [],
        link: async () => undefined,
      },
    });
    const consume = vi.fn(async () => {
      expect(
        files.entries.has(`/memory/pica-sessions/${FIRST}/report.txt`),
      ).toBe(true);
    });
    const input = createInput(isEmployee, consume);
    await service.start(input);
    await vi.waitFor(() => expect(world.opened).toHaveBeenCalledOnce());
    files.seed(`/memory/pica-sessions/${FIRST}/report.txt`, "file", "bytes");
    await service.runMaintenance();
    expect(files.entries.has(`/memory/pica-sessions/${FIRST}/report.txt`)).toBe(
      true,
    );
    world.complete();
    await service.settled(OWNER, FIRST);
    expect(files.entries.has(`/memory/pica-sessions/${FIRST}`)).toBe(false);
    if (isEmployee) expect(consume).toHaveBeenCalledOnce();
    expect(repositories.saved()).toMatchObject({
      acpSessionId: "native-session",
    });
    world.opened.mockImplementationOnce(async (nextInput, signal, observer) => {
      expect(files.entries.has(`/memory/pica-sessions/${FIRST}`)).toBe(true);
      expect(
        files.entries.has(`/memory/pica-sessions/${FIRST}/report.txt`),
      ).toBe(false);
      expect(nextInput.chat?.resumeSessionId).toBe("native-session");
      nextInput.chat?.listener.initialized?.(true, {});
      observer.identified("native-session");
      return { turn: Promise.resolve(completedTurn()), close: world.close };
    });
    await service.start(createInput(isEmployee, async () => undefined));
    await service.settled(OWNER, FIRST);
    expect(files.entries.has(`/memory/pica-sessions/${FIRST}`)).toBe(false);
    await requests.shutdown();
  },
);
