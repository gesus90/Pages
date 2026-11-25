import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ canProcess: true }));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (...args: [string, () => Promise<void>]) =>
    args[1](),
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));
vi.mock("@/backend/runtime/ServiceWorkHealth", () => ({
  recordServiceProgress: vi.fn(),
}));
vi.mock("./IntegrationProcessing", () => ({
  canProcessIntegrations: () => state.canProcess,
}));

import { ProjectNotFoundError } from "@/backend/error/ProjectErrors";

import { GitHubJobWorker } from "./GitHubJobWorker";

import type { Mock } from "vitest";
import type { GitHubJob } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import type { GitHubJobWorkerDependencies } from "./GitHubJobWorker";

const summary = {
  pushed: 0,
  pulled: 0,
  created: 0,
  detected: 0,
  conflicts: 0,
  pullRequests: 0,
};

function jobOf(command: unknown, attempts = 1): GitHubJob {
  return { id: "job-1", command, attempts } as unknown as GitHubJob;
}

interface Fixture {
  readonly worker: GitHubJobWorker;
  readonly jobs: Record<string, Mock>;
  readonly github: Record<string, Mock>;
}

function setup(user: unknown = { id: "u", isActive: true }): Fixture {
  const jobs = {
    recover: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => "id"),
    prune: vi.fn(async () => undefined),
    claim: vi.fn(async (): Promise<GitHubJob | null> => null),
    finish: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const github = {
    runScheduledSyncs: vi.fn(async () => ({ completed: 3, failed: 1 })),
    syncProjectNow: vi.fn(async () => summary),
    syncSingleTask: vi.fn(async () => summary),
    publishTaskUpdate: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => true),
    importExternalIssue: vi.fn(async () => ({ id: "imp" })),
    linkExternalIssue: vi.fn(async () => ({ id: "lnk" })),
    resolveConflict: vi.fn(async () => ({ id: "res" })),
  };
  const users = { findById: vi.fn(async () => user) };
  const tasks = { getById: vi.fn(async () => ({ id: "task" })) };
  const worker = new GitHubJobWorker({
    jobs,
    github,
    users,
    tasks,
  } as unknown as GitHubJobWorkerDependencies);
  return { worker, jobs, github };
}

async function runPass(worker: GitHubJobWorker): Promise<void> {
  await worker.start();
  await worker.stop();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  state.canProcess = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GitHubJobWorker lifecycle", () => {
  it("does not start without ownership", async () => {
    state.canProcess = false;
    const { worker, jobs } = setup();
    await worker.start();
    expect(jobs.recover).not.toHaveBeenCalled();
  });

  it("starts once and polls", async () => {
    const { worker, jobs } = setup();
    await worker.start();
    await worker.start();
    expect(jobs.recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    await worker.stop();
    expect(jobs.claim).toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith(
      { operation: "scheduled" },
      "scheduled",
    );
    expect(jobs.prune).toHaveBeenCalled();
  });

  it("stops without a timer", async () => {
    const { worker } = setup();
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it("skips polling once stopped, while running or after losing ownership", async () => {
    const { worker, jobs } = setup();
    await worker.start();
    state.canProcess = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(jobs.claim).toHaveBeenCalledTimes(1);
    await worker.stop();
    state.canProcess = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobs.claim).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while a pass is running", async () => {
    const { worker, jobs } = setup();
    let release: () => void = () => undefined;
    jobs.claim.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(null))),
    );
    await worker.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(jobs.claim).toHaveBeenCalledTimes(1);
    release();
    await worker.stop();
  });

  it("backs off after a failed pass", async () => {
    const { worker, jobs } = setup();
    jobs.claim.mockRejectedValueOnce(new Error("db"));
    await worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobs.claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    await worker.stop();
    expect(jobs.claim.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not enqueue the schedule twice within a minute", async () => {
    const { worker, jobs } = setup();
    await worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    await worker.stop();
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });
});

async function deliver(job: GitHubJob, user?: unknown): Promise<Fixture> {
  const fixture = setup(user);
  fixture.jobs.claim.mockResolvedValueOnce(job);
  await runPass(fixture.worker);
  return fixture;
}

describe("GitHubJobWorker execution", () => {
  it("finishes a scheduled job", async () => {
    const { jobs } = await deliver(jobOf({ operation: "scheduled" }));
    expect(jobs.finish).toHaveBeenCalledWith("job-1", {
      kind: "scheduled",
      completed: 3,
      failed: 1,
    });
  });

  it("denies inactive and unknown actors", async () => {
    const base = { operation: "project", actorId: "a", targetId: "t" };
    const inactive = await deliver(jobOf(base), { isActive: false });
    expect(inactive.jobs.finish).toHaveBeenCalledWith("job-1", {
      kind: "error",
      code: "project_access",
    });
    const missing = await deliver(jobOf(base), null);
    expect(missing.jobs.finish).toHaveBeenCalledWith("job-1", {
      kind: "error",
      code: "project_access",
    });
  });

  it.each([
    [{ operation: "project" }, { kind: "summary", summary }],
    [{ operation: "single" }, { kind: "summary", summary }],
    [{ operation: "publish" }, { kind: "void" }],
    [{ operation: "test" }, { kind: "boolean", result: true }],
    [
      { operation: "import", issueNumber: 4 },
      { kind: "task", id: "imp" },
    ],
    [
      { operation: "link", externalId: "e" },
      { kind: "task", id: "lnk" },
    ],
    [
      { operation: "resolve", resolution: "pages" },
      { kind: "task", id: "res" },
    ],
  ])("executes %j", async (extra, expected) => {
    const { jobs } = await deliver(
      jobOf({ actorId: "a", targetId: "t", ...extra }),
    );
    expect(jobs.finish).toHaveBeenCalledWith("job-1", expected);
  });
});

describe("GitHubJobWorker failures", () => {
  it("finishes with a domain error code", async () => {
    const fixture = setup();
    fixture.github.syncProjectNow.mockRejectedValueOnce(
      new ProjectNotFoundError(),
    );
    fixture.jobs.claim.mockResolvedValueOnce(
      jobOf({ operation: "project", actorId: "a", targetId: "t" }),
    );
    await runPass(fixture.worker);
    expect(fixture.jobs.finish).toHaveBeenCalledWith("job-1", {
      kind: "error",
      code: "project_missing",
    });
  });

  it("fails an import without retrying", async () => {
    const fixture = setup();
    fixture.github.importExternalIssue.mockRejectedValueOnce(new Error("x"));
    fixture.jobs.claim.mockResolvedValueOnce(
      jobOf({
        operation: "import",
        actorId: "a",
        targetId: "t",
        issueNumber: 1,
      }),
    );
    await runPass(fixture.worker);
    expect(fixture.jobs.finish).toHaveBeenCalledWith("job-1", {
      kind: "error",
      code: "integration_failed",
    });
  });

  it("fails after too many attempts", async () => {
    const fixture = setup();
    fixture.github.syncProjectNow.mockRejectedValueOnce(new Error("x"));
    fixture.jobs.claim.mockResolvedValueOnce(
      jobOf({ operation: "project", actorId: "a", targetId: "t" }, 6),
    );
    await runPass(fixture.worker);
    expect(fixture.jobs.finish).toHaveBeenCalledWith("job-1", {
      kind: "error",
      code: "integration_failed",
    });
  });

  it("retries with exponential delay", async () => {
    const fixture = setup();
    fixture.github.syncProjectNow.mockRejectedValue(new Error("x"));
    fixture.jobs.claim.mockResolvedValueOnce(
      jobOf({ operation: "project", actorId: "a", targetId: "t" }, 3),
    );
    await runPass(fixture.worker);
    expect(fixture.jobs.retry).toHaveBeenCalledWith("job-1", 120);
  });
});
