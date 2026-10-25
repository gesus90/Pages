import type { RunnerJob, RunnerReply } from "@/definition/RunnerProtocol";

const VIEWER_LEASE_MILLISECONDS = 30_000;
const RENEWAL_MILLISECONDS = 10_000;

/** Expiring plan viewers, independent of browser cleanup, users or durable job state. */
export class RunnerObservation {
  private readonly viewers = new Map<string, number>();
  private readonly jobs = new Map<string, readonly RunnerJob[]>();
  private readonly channels = new Map<
    string,
    {
      readonly send: (reply: RunnerReply) => void;
      readonly plans: ReadonlySet<string>;
      readonly sent: Map<string, number>;
    }
  >();

  /** Keeps only capable runners and their server-owned job bindings. */
  public configure(
    connectionId: string,
    jobs: readonly RunnerJob[],
    isSupported: boolean,
  ): void {
    if (isSupported) this.jobs.set(connectionId, jobs);
    else this.jobs.delete(connectionId);
  }

  /** Renews an already authorized view; opening also asks for current remote progress immediately. */
  public observe(planId: string, isOpening: boolean): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.viewers)
      if (expiresAt <= now) this.viewers.delete(id);
    this.viewers.set(planId, now + VIEWER_LEASE_MILLISECONDS);
    for (const channel of this.channels.values()) {
      if (!channel.plans.has(planId)) continue;
      if (
        !isOpening &&
        now - (channel.sent.get(planId) ?? 0) < RENEWAL_MILLISECONDS
      )
        continue;
      channel.send({
        version: 1,
        type: "observation",
        planId,
        leaseMilliseconds: VIEWER_LEASE_MILLISECONDS,
        refresh: isOpening,
      });
      channel.sent.set(planId, now);
    }
  }

  /** Connects only a runner that advertised observation support, also after reconnect or dispatch. */
  public attach(
    connectionId: string,
    send: (reply: RunnerReply) => void,
  ): void {
    const jobs = this.jobs.get(connectionId);
    if (!jobs) return;
    const previous = this.channels.get(connectionId);
    const plans = new Set(
      jobs.flatMap((job) => (job.plan ? [job.plan.planId] : [])),
    );
    this.channels.set(connectionId, {
      send,
      plans,
      sent: previous?.sent ?? new Map<string, number>(),
    });
    for (const planId of plans) {
      const expiresAt = this.viewers.get(planId) ?? 0;
      if (expiresAt <= Date.now() || previous?.plans.has(planId)) continue;
      send({
        version: 1,
        type: "observation",
        planId,
        leaseMilliseconds: Math.max(1, expiresAt - Date.now()),
        refresh: true,
      });
    }
  }

  /** Drops transport state; a reconnect receives the still valid viewers again. */
  public detach(connectionId: string): void {
    this.channels.delete(connectionId);
    this.jobs.delete(connectionId);
  }
}
