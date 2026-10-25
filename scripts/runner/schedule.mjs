const OBSERVED_MILLISECONDS = 2000;
const ACTIVE_MILLISECONDS = 15000;
const IDLE_MILLISECONDS = 60000;

/** Per-plan expiring viewers; no browser departure message is needed to slow down again. */
export class RunnerSchedule {
  viewers = new Map();
  checked = new Map();

  observe(message, jobs) {
    if (
      !/^[a-f0-9-]{36}$/.test(message.planId) ||
      !Number.isFinite(message.leaseMilliseconds) ||
      message.leaseMilliseconds <= 0 ||
      message.leaseMilliseconds > 30000
    )
      throw new Error("Invalid observation lease");
    this.viewers.set(message.planId, Date.now() + message.leaseMilliseconds);
    if (message.refresh)
      for (const job of jobs)
        if (job.plan?.planId === message.planId) this.checked.delete(job.jobId);
  }

  interval(job) {
    const expiresAt = this.viewers.get(job.plan?.planId) ?? 0;
    if (expiresAt > Date.now()) return OBSERVED_MILLISECONDS;
    return ["queued", "accepted", "running"].includes(job.status)
      ? ACTIVE_MILLISECONDS
      : IDLE_MILLISECONDS;
  }

  isDue(job) {
    return (
      Date.now() - (this.checked.get(job.jobId) ?? 0) >= this.interval(job)
    );
  }

  polled(job, checkedAt = Date.now()) {
    this.checked.set(job.jobId, checkedAt);
  }

  delay(jobs) {
    const active = jobs.filter(
      (job) =>
        ["queued", "accepted", "running"].includes(job.status) ||
        (job.historyLength ?? 0) > (job.historyCursor ?? 0),
    );
    if (!active.length) return IDLE_MILLISECONDS;
    return Math.max(
      0,
      Math.min(
        ...active.map(
          (job) =>
            (this.checked.get(job.jobId) ?? 0) +
            this.interval(job) -
            Date.now(),
        ),
      ),
    );
  }
}
