import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerReply } from "@/definition/RunnerProtocol";

/** Persists queue-only pause intent before transport delivery, including offline requests. */
export class RunnerQueuedPause {
  private readonly repository: Pick<RunnerRepository, "find" | "checkpoint">;
  private readonly writes: SerialQueue;
  private readonly deliver: (connectionId: string, reply: RunnerReply) => void;

  public constructor(
    repository: Pick<RunnerRepository, "find" | "checkpoint">,
    writes: SerialQueue,
    deliver: (connectionId: string, reply: RunnerReply) => void,
  ) {
    this.repository = repository;
    this.writes = writes;
    this.deliver = deliver;
  }

  /** A racing launch drains normally; only an exclusive never-spawned claim may be paused. */
  public async request(connectionId: string, jobId: string): Promise<void> {
    await this.writes.run(async () => {
      const record = await this.repository.find(connectionId);
      const job = record?.state.jobs.find((entry) => entry.jobId === jobId);
      if (!record || !job?.plan || job.status !== "queued" || job.cancellation)
        return;
      const requested = {
        ...job,
        pauseRequestedAt: job.pauseRequestedAt ?? new Date().toISOString(),
      };
      await this.repository.checkpoint(connectionId, {
        ...record.state,
        jobs: record.state.jobs.map((entry) =>
          entry.jobId === jobId ? requested : entry,
        ),
      });
      this.deliver(connectionId, {
        version: 1,
        type: "pause-queued",
        job: requested,
      });
    });
  }
}
