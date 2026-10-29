import { randomUUID } from "node:crypto";

import { admitJob, releaseJob } from "./admission.mjs";
import {
  canIsolateJobs,
  claimJob,
  observeJob,
  cancellationFor,
  cancelQueuedJob,
  refuseQueuedJob,
} from "./execution.mjs";
import { hasExecutionLease, cancelJob } from "./revocation.mjs";
import { liveBatch } from "./live.mjs";
import { sendRunnerPacket } from "./wire.mjs";

const TERMINAL_STATES = ["completed", "failed", "interrupted", "lost"];

function eventPacket(event) {
  const job = { ...event.job };
  delete job.execution;
  return { ...event, delta: true, job };
}

function observedStatus(job, observed) {
  if (job.status === "queued" && observed.launch) return "accepted";
  if (job.status === "accepted") return "running";
  return observed.status;
}

/** One existing sequenced journal; worker observation never owns the stop channel. */
export class RunnerJobs {
  #context;
  #snapshots = new Map();
  #progress = new Map();
  #pendingSentAt = 0;
  #lastPolledJobId = null;

  constructor(context) {
    this.#context = context;
  }

  /** Reconciliation invalidates unconfirmed observations, never durable claims. */
  clear() {
    this.#snapshots.clear();
  }

  /** Retries the exact pending event promptly, independent of viewer cadence. */
  delay() {
    const { configuration, completionNotices, schedule } = this.#context;
    if (configuration.pending)
      return Math.max(0, this.#pendingSentAt + 2000 - Date.now());
    if (completionNotices.size) return 0;
    return schedule.delay(configuration.jobs);
  }

  /** Records dispatch before admission; identical retries do not create another worker. */
  async receive(message) {
    const { configuration, persist, schedule } = this.#context;
    if (message.type === "dispatch") {
      const previous = configuration.jobs.find(
        (entry) => entry.jobId === message.job.jobId,
      );
      if (previous) {
        if (
          previous.sessionId !== message.job.sessionId ||
          JSON.stringify(previous.plan) !== JSON.stringify(message.job.plan) ||
          JSON.stringify(previous.execution) !==
            JSON.stringify(message.job.execution)
        )
          throw new Error("Conflicting runner dispatch");
      } else {
        if (
          configuration.jobs.length >= 1000 ||
          message.job.sessionId !== configuration.sessionId
        )
          throw new Error("Runner queue unavailable");
        configuration.jobs.push(message.job);
        await persist();
      }
      schedule.checked.delete(message.job.jobId);
      return;
    }
    if (
      !["ack", "history-deferred"].includes(message.type) ||
      !configuration.pending ||
      configuration.pending.eventId !== message.eventId
    )
      return;
    if (message.sequence !== configuration.pending.sequence)
      throw new Error("Runner acknowledgement sequence mismatch");
    const pending = configuration.pending;
    if (message.type === "history-deferred") {
      configuration.deferredHistory ??= [];
      configuration.deferredHistory.push({
        eventId: pending.eventId,
        jobId: pending.job.jobId,
        sequence: message.sequence,
      });
      console.error(
        `Runner history durably deferred for job ${pending.job.jobId}; Pages recovery required.`,
      );
    }
    configuration.sequence = message.sequence;
    configuration.jobs = configuration.jobs.map((job) =>
      job.jobId === pending.job.jobId ? pending.job : job,
    );
    configuration.pending = null;
    await persist();
  }

  /** Round-robin bounded packets keep other launches and terminal results moving under log load. */
  async poll(channel) {
    const { configuration, completionNotices, schedule } = this.#context;
    if (channel.readyState !== WebSocket.OPEN) return;
    if (configuration.pending) {
      this.#send(channel, configuration.pending);
      return;
    }
    for (const job of this.#pollingOrder()) {
      if (completionNotices.delete(job.jobId)) {
        schedule.checked.delete(job.jobId);
        this.#snapshots.delete(job.jobId);
      }
      const isTerminal = TERMINAL_STATES.includes(job.status);
      if (isTerminal && (job.historyCursor ?? 0) >= (job.historyLength ?? 0))
        continue;
      if (!this.#snapshots.has(job.jobId) && !schedule.isDue(job)) continue;
      if (job.status === "queued") {
        const reason = await this.#admit(job);
        if (reason) {
          if (job.queueReason !== reason)
            return this.#reportQueue(channel, job, reason);
          schedule.polled(job);
          continue;
        }
      }
      const snapshot = await this.#observe(job);
      if (!snapshot.observed) {
        schedule.polled(job, snapshot.checkedAt);
        continue;
      }
      if (
        TERMINAL_STATES.includes(snapshot.observed.status) &&
        snapshot.observed.result?.closeout === "confirmed"
      )
        await releaseJob(job);
      const event = this.#event(job, snapshot);
      if (!event) continue;
      configuration.pending = event;
      await this.#context.persist();
      this.#send(channel, event);
      return;
    }
  }

  async #admit(job) {
    const { directory } = this.#context;
    if (!(await hasExecutionLease(directory, job))) {
      await cancelJob(directory, {
        ...job,
        cancellation: { requestedAt: new Date().toISOString() },
      });
      return null;
    }
    if (await cancellationFor(directory, job)) {
      await cancelQueuedJob(directory, job);
      return null;
    }
    if (!(await canIsolateJobs())) {
      // No worker may start where its process tree could not be owned.
      await refuseQueuedJob(directory, job, "cli_isolation_unavailable");
      return null;
    }
    let reason;
    try {
      reason = await admitJob(directory, job);
    } catch {
      // A broken host lock must end this job visibly instead of closing the shared channel.
      console.error(`Runner admission failed for job ${job.jobId}.`);
      await refuseQueuedJob(directory, job);
      return null;
    }
    if (!reason) await claimJob(directory, job);
    return reason;
  }

  async #observe(job) {
    const cached =
      job.outputJournalVersion === 2 ? null : this.#snapshots.get(job.jobId);
    return (
      cached ?? {
        checkedAt: Date.now(),
        observed: await observeJob(this.#context.directory, job),
      }
    );
  }

  #event(job, snapshot) {
    const { observed, checkedAt } = snapshot;
    const { configuration, schedule } = this.#context;
    const history = liveBatch(observed.history, job.historyCursor ?? 0);
    const status = observedStatus(job, observed);
    if (
      status === "running" &&
      job.status === "running" &&
      !history.length &&
      this.#progress.get(job.jobId) === JSON.stringify(observed.result) &&
      Date.now() - Date.parse(job.observedAt ?? "1970-01-01T00:00:00.000Z") <
        15000
    ) {
      schedule.polled(job, checkedAt);
      return null;
    }
    const hasMoreHistory =
      (observed.historyLength ?? observed.history?.at(-1)?.sequence ?? 0) >
      (history.at(-1)?.sequence ?? job.historyCursor ?? 0);
    const updated = {
      ...job,
      status,
      queueReason: null,
      observedAt: new Date().toISOString(),
      ...(observed.cancellation ? { cancellation: observed.cancellation } : {}),
      ...(job.liveHistoryVersion === 1
        ? { historyCursor: history.at(-1)?.sequence ?? job.historyCursor ?? 0 }
        : {}),
      ...(observed.launch ? { launch: observed.launch } : {}),
      ...(observed.historyFailure
        ? { historyFailure: observed.historyFailure }
        : {}),
      ...(job.liveHistoryVersion === 1 && TERMINAL_STATES.includes(status)
        ? {
            historyLength:
              observed.historyLength ?? observed.history?.at(-1)?.sequence ?? 0,
          }
        : {}),
    };
    if (
      hasMoreHistory ||
      status === "accepted" ||
      (status === "running" && observed.status !== "running")
    )
      this.#snapshots.set(job.jobId, snapshot);
    else {
      this.#snapshots.delete(job.jobId);
      schedule.polled(job, checkedAt);
    }
    this.#progress.set(job.jobId, JSON.stringify(observed.result));
    this.#lastPolledJobId = job.jobId;
    return {
      version: 1,
      type: "event",
      sessionId: configuration.sessionId,
      eventId: randomUUID(),
      sequence: configuration.sequence + 1,
      job: updated,
      ...(history.length ? { history } : {}),
      ...(TERMINAL_STATES.includes(job.status) ||
      (["queued", "accepted"].includes(job.status) &&
        !TERMINAL_STATES.includes(status))
        ? {}
        : { result: observed.result }),
    };
  }

  #pollingOrder() {
    const { configuration, completionNotices } = this.#context;
    const previous = configuration.jobs.findIndex(
      (job) => job.jobId === this.#lastPolledJobId,
    );
    const ordered = [
      ...configuration.jobs.slice(previous + 1),
      ...configuration.jobs.slice(0, previous + 1),
    ];
    return ordered.sort(
      (first, second) =>
        Number(completionNotices.has(second.jobId)) -
        Number(completionNotices.has(first.jobId)),
    );
  }

  async #reportQueue(channel, job, queueReason) {
    const { configuration, persist } = this.#context;
    configuration.pending = {
      version: 1,
      type: "event",
      sessionId: configuration.sessionId,
      eventId: randomUUID(),
      sequence: configuration.sequence + 1,
      job: { ...job, queueReason, observedAt: new Date().toISOString() },
    };
    await persist();
    this.#send(channel, configuration.pending);
  }

  #send(channel, event) {
    sendRunnerPacket(channel, eventPacket(event));
    this.#pendingSentAt = Date.now();
  }
}
