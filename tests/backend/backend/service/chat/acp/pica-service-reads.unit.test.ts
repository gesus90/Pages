import { expect, it, vi } from "vitest";

import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";

import { FIRST, OWNER, SECOND, SESSION } from "../page48-chat-fixture";

import type { PicaAcpServiceDependencies } from "@/backend/service/chat/acp/PicaAcpService";
import type { ChatJob, ChatJobEntry } from "@/definition/ChatJob";

vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

function fixture(): {
  service: PicaAcpService;
  jobs: PicaAcpServiceDependencies["jobs"];
  steers: PicaAcpServiceDependencies["steers"];
  requireSession: ReturnType<typeof vi.fn>;
} {
  const database = { query: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
  const jobs = new ChatJobRepository(database);
  const steers = new ChatSteerRepository(database);
  vi.spyOn(jobs, "interruptRunning").mockResolvedValue([]);
  vi.spyOn(jobs, "latest").mockResolvedValue(null);
  vi.spyOn(jobs, "find").mockResolvedValue(null);
  vi.spyOn(jobs, "findByMessage").mockResolvedValue(null);
  vi.spyOn(jobs, "recent").mockResolvedValue([]);
  vi.spyOn(jobs, "events").mockResolvedValue([]);
  vi.spyOn(steers, "list").mockResolvedValue([]);
  vi.spyOn(steers, "selections").mockResolvedValue([]);
  const requireSession = vi.fn(async () => SESSION);
  const dependencies: PicaAcpServiceDependencies = {
    jobs,
    steers,
    sessions: { require: requireSession, confirmationWord: vi.fn() },
    acpSessions: new ChatAcpSessionRepository(database),
    plans: { open: vi.fn() },
    messages: { append: vi.fn(), messages: vi.fn() },
    attachments: {
      pending: vi.fn(),
      link: vi.fn(),
      readText: vi.fn(),
      readBytes: vi.fn(),
    },
    bridge: { open: vi.fn() },
    tools: { run: vi.fn() },
    access: { requireUser: vi.fn() },
    requests: new ChatRequestRegistry(),
    workspace: new PicaAcpWorkspace("/synthetic"),
  };
  return {
    service: new PicaAcpService(dependencies),
    jobs,
    steers,
    requireSession,
  };
}

it("paginates an authorized journal and validates cursors", async () => {
  const { service, jobs, requireSession } = fixture();
  const job: ChatJob = {
    id: "job",
    sessionId: FIRST,
    state: "running",
    errorCode: null,
    createdAt: "today",
    endedAt: null,
    usage: { context: null, tokens: null, cost: null },
  };
  const events: ChatJobEntry[] = Array.from({ length: 201 }, (_, index) => ({
    sequence: index + 1,
    event: { kind: "text", turn: 1, isReset: false, delta: "x" },
  }));
  vi.mocked(jobs.latest).mockResolvedValue(job);
  vi.mocked(jobs.events).mockResolvedValue(events);
  const update = await service.update(OWNER, { sessionId: FIRST, after: 0 });
  expect(update).toEqual({
    job,
    events: events.slice(0, 200),
    cursor: 200,
    hasMore: true,
  });
  expect(jobs.events).toHaveBeenCalledWith(OWNER.id, job.id, {
    after: 0,
    limit: 201,
  });
  expect(requireSession).toHaveBeenCalledWith(OWNER, FIRST);
  await expect(
    service.update(OWNER, { sessionId: FIRST, after: -1 }),
  ).rejects.toThrow();
  vi.mocked(jobs.latest).mockResolvedValue({ ...job, sessionId: SECOND });
  await expect(service.update(OWNER, { sessionId: FIRST })).resolves.toBeNull();
  expect(jobs.interruptRunning).toHaveBeenCalledOnce();
});

it("recovers again after interruption fails and reads activity", async () => {
  const { service, jobs, steers } = fixture();
  vi.mocked(jobs.interruptRunning).mockRejectedValueOnce(
    new Error("recovery failed"),
  );
  await expect(service.activity(OWNER.id, FIRST)).rejects.toThrow(
    "recovery failed",
  );
  await expect(service.activity(OWNER.id, FIRST)).resolves.toEqual({
    job: null,
    steers: [],
    selections: [],
  });
  expect(jobs.interruptRunning).toHaveBeenCalledTimes(2);
  expect(steers.list).toHaveBeenCalledWith(FIRST);
  expect(steers.selections).toHaveBeenCalledWith(FIRST);
  await expect(service.outcome(OWNER.id, FIRST, "missing")).resolves.toBeNull();
});

it("reads journals in chronological order and keeps empty pages at the cursor", async () => {
  const { service, jobs, requireSession } = fixture();
  const newest: ChatJob = {
    id: "newest",
    sessionId: FIRST,
    state: "completed",
    errorCode: null,
    createdAt: "today",
    endedAt: "today",
    usage: { context: null, tokens: null, cost: null },
  };
  const oldest = { ...newest, id: "oldest" };
  vi.mocked(jobs.recent).mockResolvedValue([newest, oldest]);
  await expect(
    service.journals(OWNER, FIRST, { jobs: 2, entries: 5 }),
  ).resolves.toEqual([
    { job: oldest, events: [] },
    { job: newest, events: [] },
  ]);
  expect(jobs.events).toHaveBeenNthCalledWith(1, OWNER.id, "oldest", {
    after: 0,
    limit: 5,
  });
  expect(requireSession).toHaveBeenCalledWith(OWNER, FIRST);
  vi.mocked(jobs.latest).mockResolvedValue(newest);
  await expect(
    service.update(OWNER, { sessionId: FIRST, after: 42 }),
  ).resolves.toEqual({
    job: newest,
    events: [],
    cursor: 42,
    hasMore: false,
  });
});

it("does not steer when the authorized conversation has no running job", async () => {
  const { service, steers, requireSession } = fixture();
  const create = vi.spyOn(steers, "create");
  await expect(
    service.steer(OWNER, {
      sessionId: FIRST,
      clientMessageId: null,
      text: "hello",
      attachmentIds: [],
    }),
  ).resolves.toBeNull();
  expect(requireSession).toHaveBeenCalledWith(OWNER, FIRST);
  expect(create).not.toHaveBeenCalled();
});
