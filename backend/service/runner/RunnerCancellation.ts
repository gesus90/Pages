import { logCaughtError } from "@/backend/logging/Logger";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerJob, RunnerReply } from "@/definition/RunnerProtocol";

interface CancellationDependencies {
  readonly repository: RunnerRepository;
  readonly writes: SerialQueue;
  readonly deliver: (connectionId: string, reply: RunnerReply) => void;
}

/** Stop intent lives beside its original claim and is replayed before queued dispatch. */
export class RunnerCancellation {
  private readonly dependencies: CancellationDependencies;
  private readonly sent = new Map<string, number>();

  public constructor(dependencies: CancellationDependencies) {
    this.dependencies = dependencies;
  }

  /** Checkpoints the request even when the runner is offline; retries retain its timestamp. */
  public async request(connectionId: string, jobId: string): Promise<void> {
    await this.dependencies.writes.run(async () => {
      const record = await this.dependencies.repository.find(connectionId);
      const job = record?.state.jobs.find((entry) => entry.jobId === jobId);
      // A runner binds stop delivery to a plan attempt; a job without one has nothing to target.
      if (
        !record ||
        !job?.plan ||
        !["queued", "accepted", "running"].includes(job.status)
      )
        return;
      const requested = {
        ...job,
        cancellation: job.cancellation ?? {
          requestedAt: new Date().toISOString(),
        },
      };
      if (!job.cancellation)
        await this.dependencies.repository.checkpoint(connectionId, {
          ...record.state,
          jobs: record.state.jobs.map((entry) =>
            entry.jobId === jobId ? requested : entry,
          ),
        });
      this.deliver(connectionId, requested);
    });
  }

  /** Reconnection reuses the persisted request; no replacement attempt is created. */
  public replay(connectionId: string): void {
    void this.dependencies.repository
      .find(connectionId)
      .then((record) => {
        for (const job of record?.state.jobs ?? []) {
          if (
            job.cancellation &&
            ["queued", "accepted", "running"].includes(job.status)
          )
            this.deliver(connectionId, job);
        }
      })
      .catch((error: unknown) => logCaughtError("RunnerCancellation", error));
  }

  private deliver(connectionId: string, job: RunnerJob): void {
    const key = `${connectionId}:${job.jobId}`;
    if (Date.now() - (this.sent.get(key) ?? 0) < 2000) return;
    this.sent.set(key, Date.now());
    this.dependencies.deliver(connectionId, {
      version: 1,
      type: "cancel",
      jobId: job.jobId,
      sessionId: job.sessionId,
      attemptId: job.plan?.attemptId,
      requestedAt: job.cancellation?.requestedAt,
    });
  }
}
