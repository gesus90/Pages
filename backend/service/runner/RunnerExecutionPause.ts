import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerReply } from "@/definition/RunnerProtocol";

/** Durable reversible control of the original remote job, replayed on reconnect. */
export class RunnerExecutionPause {
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

  /** Persists the desired state before touching the transport; Stop always wins. */
  public async request(
    connectionId: string,
    jobId: string,
    isPaused: boolean,
  ): Promise<void> {
    await this.writes.run(async () => {
      const record = await this.repository.find(connectionId);
      const job = record?.state.jobs.find((entry) => entry.jobId === jobId);
      if (
        !record ||
        !job?.plan ||
        job.cancellation ||
        !["queued", "accepted", "running"].includes(job.status)
      )
        return;
      const requested = { ...job, isPaused };
      await this.repository.checkpoint(connectionId, {
        ...record.state,
        jobs: record.state.jobs.map((entry) =>
          entry.jobId === jobId ? requested : entry,
        ),
      });
      this.deliver(connectionId, {
        version: 1,
        type: "execution-pause",
        job: requested,
      });
    });
  }
}
