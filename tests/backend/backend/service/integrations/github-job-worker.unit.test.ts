import { describe, expect, it, vi } from "vitest";

import { GitHubJobWorker } from "@/backend/service/integrations/GitHubJobWorker";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { GitHubJob } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import type { GitHubJobWorkerDependencies } from "@/backend/service/integrations/GitHubJobWorker";

vi.mock("@/backend/service/integrations/IntegrationProcessing", () => ({
  canProcessIntegrations: () => true,
}));

function fixture(job: GitHubJob): {
  worker: GitHubJobWorker;
  finish: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  github: GitHubJobWorkerDependencies["github"];
} {
  const finish = vi.fn().mockResolvedValue(undefined);
  const retry = vi.fn().mockResolvedValue(undefined);
  const github = partial<GitHubJobWorkerDependencies["github"]>({
    runScheduledSyncs: vi.fn().mockResolvedValue({ completed: 2, failed: 1 }),
    syncProjectNow: vi.fn().mockResolvedValue({ count: 1 }),
    syncSingleTask: vi.fn().mockResolvedValue({ count: 1 }),
    publishTaskUpdate: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue(true),
    importExternalIssue: vi.fn().mockResolvedValue({ id: "task" }),
    linkExternalIssue: vi.fn().mockResolvedValue({ id: "task" }),
    resolveConflict: vi.fn().mockResolvedValue({ id: "task" }),
  });
  const dependencies = partial<GitHubJobWorkerDependencies>({
    jobs: partial({
      recover: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn().mockResolvedValue("scheduled"),
      prune: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
      finish,
      retry,
    }),
    github,
    users: partial({
      findById: vi.fn().mockResolvedValue({ id: "u", isActive: true }),
    }),
    tasks: partial({ getById: vi.fn().mockResolvedValue({ id: "task" }) }),
  });
  return { worker: new GitHubJobWorker(dependencies), finish, retry, github };
}

async function run(job: GitHubJob): Promise<{
  finish: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}> {
  const { worker, finish, retry } = fixture(job);
  await worker.start();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  await worker.stop();
  return { finish, retry };
}

describe("GitHub job worker", () => {
  it("delivers scheduled and user operations through mocked services", async () => {
    for (const [command, kind] of [
      [{ operation: "scheduled" }, "scheduled"],
      [{ operation: "project", actorId: "u", targetId: "p" }, "summary"],
      [{ operation: "single", actorId: "u", targetId: "t" }, "summary"],
      [{ operation: "publish", actorId: "u", targetId: "t" }, "void"],
      [{ operation: "test", actorId: "u", targetId: "p" }, "boolean"],
      [
        { operation: "import", actorId: "u", targetId: "p", issueNumber: 1 },
        "task",
      ],
      [
        { operation: "link", actorId: "u", targetId: "t", externalId: "1" },
        "task",
      ],
      [
        {
          operation: "resolve",
          actorId: "u",
          targetId: "t",
          resolution: "local",
        },
        "task",
      ],
    ] as const) {
      const { finish } = await run(
        partial<GitHubJob>({ id: "j", attempts: 1, command: partial(command) }),
      );
      expect(finish).toHaveBeenCalledWith(
        "j",
        expect.objectContaining({ kind }),
      );
    }
  });

  it("retries transient failures but completes an import failure without repeating it", async () => {
    const first = fixture(
      partial<GitHubJob>({
        id: "j",
        attempts: 2,
        command: partial({ operation: "project", actorId: "u", targetId: "p" }),
      }),
    );
    vi.mocked(first.github.syncProjectNow).mockRejectedValueOnce(
      new Error("offline"),
    );
    await first.worker.start();
    await vi.waitFor(() => expect(first.retry).toHaveBeenCalledWith("j", 60));
    await first.worker.stop();
    const second = fixture(
      partial<GitHubJob>({
        id: "j",
        attempts: 1,
        command: partial({
          operation: "import",
          actorId: "u",
          targetId: "p",
          issueNumber: 1,
        }),
      }),
    );
    vi.mocked(second.github.importExternalIssue).mockRejectedValueOnce(
      new Error("offline"),
    );
    await second.worker.start();
    await vi.waitFor(() =>
      expect(second.finish).toHaveBeenCalledWith("j", {
        kind: "error",
        code: "integration_failed",
      }),
    );
    await second.worker.stop();
  });
});
