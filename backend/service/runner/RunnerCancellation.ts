import { logCaughtError } from "@/backend/logging/Logger";

import { RUNNER_STOP_DEADLINE_MILLISECONDS } from "./RunnerStopState";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerJob, RunnerReply } from "@/definition/RunnerProtocol";

interface CancellationDependencies {
  readonly repository: RunnerRepository;
  readonly writes: SerialQueue;
  readonly expire: (job: RunnerJob) => Promise<void>;
  readonly deliver: (connectionId: string, reply: RunnerReply) => void;
}

/** Stop intent lives beside its original claim and is replayed before queued dispatch. */
export class RunnerCancellation {
  private readonly dependencies: CancellationDependencies;
  private readonly sent = new Map<string, number>();
  private readonly deadlines = new Map<string, NodeJS.Timeout>();
  private readonly expired = new Set<string>();

  public constructor(dependencies: CancellationDependencies) {
    this.dependencies = dependencies;
  }

  /** Checkpoints the request even when the runner is offline; retries retain its timestamp. */
  public async request(connectionId: string, jobId: string): Promise<void> {
    await this.dependencies.writes.run(async () => {
      const record = await this.dependencies.repository.find(connectionId);
      const job = record?.state.jobs.find((entry) => entry.jobId === jobId);
      // A runner binds stop delivery to a plan attempt; a job without one has nothing to target.
      if (!record || !job?.plan || job.cancellation?.closeout === "confirmed")
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
      this.watch(connectionId, requested);
    });
  }

  /** Reconnection reuses the persisted request; no replacement attempt is created. */
  public replay(connectionId: string): void {
    void this.dependencies.repository
      .find(connectionId)
      .then((record) => {
        for (const job of record?.state.jobs ?? []) {
          if (job.cancellation && job.cancellation.closeout !== "confirmed") {
            this.deliver(connectionId, job);
            this.watch(connectionId, job);
          }
        }
      })
      .catch((error: unknown) => logCaughtError("RunnerCancellation", error));
  }

  private watch(connectionId: string, job: RunnerJob): void {
    const key = `${connectionId}:${job.jobId}`;
    if (this.deadlines.has(key) || this.expired.has(key)) return;
    const timer = setTimeout(
      () => {
        this.deadlines.delete(key);
        this.expired.add(key);
        void this.dependencies.repository
          .find(connectionId)
          .then(async (record) => {
            const current = record?.state.jobs.find(
              (entry) => entry.jobId === job.jobId,
            );
            if (
              current?.cancellation &&
              current.cancellation.closeout !== "confirmed"
            )
              await this.dependencies.expire(current);
          })
          .catch((error: unknown) =>
            logCaughtError("RunnerCancellation", error),
          );
      },
      Math.max(
        0,
        Date.parse(job.cancellation?.requestedAt ?? "") +
          RUNNER_STOP_DEADLINE_MILLISECONDS -
          Date.now(),
      ),
    );
    timer.unref();
    this.deadlines.set(key, timer);
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
