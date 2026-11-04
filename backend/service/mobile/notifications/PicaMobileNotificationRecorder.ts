import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { detectPlanRunTransitions } from "@/backend/service/agents/AgentPlanRunTransitions";
import {
  PICA_MOBILE_MAXIMUM_IDENTIFIER_LENGTH,
  PICA_MOBILE_NOTIFICATION_EVENT_TYPE,
} from "@/definition/PicaMobileNotifications";

import type {
  EventCandidate,
  PicaMobileNotificationEventRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import type {
  PicaMobilePushRegistrationRepository,
  PushRegistrationRecord,
} from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type {
  AgentPlanOwnerRunReader,
  AgentPlanRunFlow,
} from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { AgentPlanRunObserver } from "@/backend/service/agents/AgentPlanRunObservers";
import type {
  AgentPlanRunEnding,
  AgentPlanStartedStep,
} from "@/backend/service/agents/AgentPlanRunTransitions";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PicaMobileNotificationEventType } from "@/definition/PicaMobileNotifications";

/** What the recorder is created with. */
export interface PicaMobileNotificationRecorderOptions {
  readonly registrations: Pick<
    PicaMobilePushRegistrationRepository,
    "listActivated"
  >;
  readonly events: Pick<PicaMobileNotificationEventRepository, "record">;
  readonly runs: Pick<AgentPlanOwnerRunReader, "read">;
  /** Seconds a notification stays worth delivering. */
  readonly replayTtlSeconds: number;
  /** Tells the dispatcher that new pushes are waiting. */
  readonly onRecorded: () => void;
  readonly now?: () => Date;
  /** How long starts of one run are collected into a single event. */
  readonly bundlingMilliseconds?: number;
  /** Pause between the attempts to decide an event. */
  readonly retryDelayMilliseconds?: number;
}

interface RunIdentity {
  readonly runId: string;
  readonly accountId: string;
  readonly planId: string;
}

interface PendingStarts extends RunIdentity {
  readonly observedAt: Date;
  readonly steps: Map<string, AgentPlanStartedStep>;
  timer: NodeJS.Timeout | null;
}

/** The devices of an account and the flow of a run it may read. */
interface Authorized {
  readonly flow: AgentPlanRunFlow;
  readonly registrations: readonly PushRegistrationRecord[];
}

interface StoreRequest extends RunIdentity {
  readonly type: PicaMobileNotificationEventType;
  readonly observedAt: Date;
  readonly candidates: readonly EventCandidate[];
  readonly reason: string | null;
  readonly registrations: readonly PushRegistrationRecord[];
}

const COMPONENT = "PicaMobileNotificationRecorder";
const DEFAULT_BUNDLING_MILLISECONDS = 1_000;
const DEFAULT_RETRY_DELAY_MILLISECONDS = 3_000;
const MAXIMUM_DECISION_ATTEMPTS = 3;
const STOP_WAIT_MILLISECONDS = 5_000;
/** The code a run carries when Pages itself stopped or restarted underneath it. */
const INTERRUPTION_REASON = "plan_interrupted";

const ENDING_EVENT: Readonly<
  Record<AgentPlanRunEnding, PicaMobileNotificationEventType>
> = {
  succeeded: PICA_MOBILE_NOTIFICATION_EVENT_TYPE.RUN_SUCCEEDED,
  failed: PICA_MOBILE_NOTIFICATION_EVENT_TYPE.RUN_FAILED,
  cancelled: PICA_MOBILE_NOTIFICATION_EVENT_TYPE.RUN_CANCELLED,
  // The event types are closed in the stored table and in Pica Mobile; the reason names this ending.
  work_done_closeout_open: PICA_MOBILE_NOTIFICATION_EVENT_TYPE.RUN_FAILED,
};

function isSafeIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= PICA_MOBILE_MAXIMUM_IDENTIFIER_LENGTH &&
    !/\s/u.test(value)
  );
}

function startKey(step: AgentPlanStartedStep): string {
  return step.loopId === null
    ? `step:${step.stepId}`
    : `loop:${step.loopId}:${step.stepId}:${step.iteration ?? 0}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/** Groups the starts of one transition: the flow itself, and each loop iteration on its own. */
function groupByTransition(
  steps: readonly AgentPlanStartedStep[],
): readonly (readonly AgentPlanStartedStep[])[] {
  const groups = new Map<string, AgentPlanStartedStep[]>();

  for (const step of steps) {
    const key = `${step.loopId ?? ""}:${step.iteration ?? ""}`;

    groups.set(key, [...(groups.get(key) ?? []), step]);
  }

  return [...groups.values()];
}

function toStoredStep(
  step: AgentPlanStartedStep,
  flow: AgentPlanRunFlow,
): EventCandidate["steps"][number] {
  return {
    instanceId:
      step.loopId === null
        ? step.stepId
        : `${step.loopId}:${step.stepId}:${step.iteration ?? 0}`,
    stepId: step.stepId,
    loopId: step.loopId,
    number: flow.numberOf(step.stepId),
    attempt: step.attempt,
    iteration: step.iteration,
  };
}

/**
 * The facts one group of starts announces.
 *
 * @remarks
 * A step of the flow is announced once. A loop is announced by its own start
 * as a step and then once per further iteration, at the first start inside it,
 * so a loop with many members does not send one event per member.
 */
function toCandidates(
  group: readonly AgentPlanStartedStep[],
  flow: AgentPlanRunFlow,
): readonly EventCandidate[] {
  const [first] = group;

  if (first === undefined) {
    return [];
  }

  if (first.loopId !== null) {
    return [
      {
        key: `loop:${first.loopId}:${first.iteration ?? 0}`,
        steps: group.map((step) => toStoredStep(step, flow)),
      },
    ];
  }

  return group.map((step) => ({
    key: startKey(step),
    steps: [toStoredStep(step, flow)],
  }));
}

/**
 * Turns committed run transitions into notification events.
 *
 * @remarks
 * It listens to the writes of runs and looks only at facts of the stored run:
 * a step that really went from waiting to running, and a run that really
 * ended. The first steps of a run, a retry of a step, a pause, a stop request
 * and the completion of a single step produce nothing, and neither does a run
 * that Pages itself interrupted by stopping or restarting. Starts that happen
 * together are collected for a moment into one event. Before anything is
 * stored the plan ownership and the rights on the concrete run are checked
 * again, and nothing is stored while no device is registered, so enabling
 * notifications never replays history. A failure here is logged and never
 * reaches the run.
 */
export class PicaMobileNotificationRecorder implements AgentPlanRunObserver {
  private readonly options: PicaMobileNotificationRecorderOptions;
  private readonly queue = new SerialQueue();
  private readonly pending = new Map<string, PendingStarts>();
  private readonly now: () => Date;
  private isStopped = false;

  /**
   * Creates the recorder.
   *
   * @param options - Storage, the rights check and the delivery signal.
   */
  public constructor(options: PicaMobileNotificationRecorderOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Looks at one committed write of a run.
   *
   * @param previous - The view of the run before the write.
   * @param next - The view after the write.
   *
   * @remarks
   * It only inspects the two views and queues work; it never waits for the
   * database, as the write that called it still holds the database.
   */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    if (this.isStopped) {
      return;
    }

    const identity = {
      runId: next.id,
      accountId: next.userId,
      planId: next.planId,
    };

    for (const transition of detectPlanRunTransitions(previous, next)) {
      if (transition.kind === "steps_started") {
        this.collect(identity, transition.steps);
      } else if (transition.reason !== INTERRUPTION_REASON) {
        const observedAt = this.now();

        this.flush(identity.runId);
        this.enqueue(() =>
          this.recordEnding(
            identity,
            { ending: transition.ending, reason: transition.reason },
            observedAt,
          ),
        );
      }
    }
  }

  /**
   * Stops accepting transitions and finishes what is already queued.
   *
   * @remarks
   * It waits a few seconds at most, so a slow database cannot hold up the
   * shutdown of Pages.
   */
  public async stop(): Promise<void> {
    for (const runId of [...this.pending.keys()]) {
      this.flush(runId);
    }

    this.isStopped = true;
    await Promise.race([
      this.queue.run(() => Promise.resolve()),
      sleep(STOP_WAIT_MILLISECONDS),
    ]);
  }

  private collect(
    identity: RunIdentity,
    steps: readonly AgentPlanStartedStep[],
  ): void {
    const pending = this.pending.get(identity.runId) ?? {
      ...identity,
      observedAt: this.now(),
      steps: new Map<string, AgentPlanStartedStep>(),
      timer: null,
    };

    for (const step of steps) {
      pending.steps.set(startKey(step), step);
    }

    if (pending.timer === null) {
      pending.timer = setTimeout(
        () => this.flush(identity.runId),
        this.options.bundlingMilliseconds ?? DEFAULT_BUNDLING_MILLISECONDS,
      );
      pending.timer.unref();
    }

    this.pending.set(identity.runId, pending);
  }

  private flush(runId: string): void {
    const pending = this.pending.get(runId);

    if (pending === undefined) {
      return;
    }

    this.pending.delete(runId);

    if (pending.timer !== null) {
      clearTimeout(pending.timer);
    }

    this.enqueue(() => this.recordStarts(pending));
  }

  private enqueue(job: () => Promise<void>): void {
    // A plan or job change happened either way; recording it must not hang on a request.
    void withBackgroundDatabaseWork("pica_mobile_notifications", () =>
      this.queue.run(async () => {
        try {
          await this.decide(job);
        } catch (error: unknown) {
          logCaughtError(COMPONENT, error);
          logEvent({
            level: "warn",
            event: "pica_mobile.notifications.event_lost",
            component: COMPONENT,
            message: "A notification event could not be recorded",
            metadata: { reason: "decision_failed" },
          });
        }
      }),
    );
  }

  /** Repeats a job whose rights check could not be decided, a few times and briefly. */
  private async decide(job: () => Promise<void>): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await job();

        return;
      } catch (error: unknown) {
        if (attempt >= MAXIMUM_DECISION_ATTEMPTS) {
          throw error;
        }

        await sleep(
          this.options.retryDelayMilliseconds ??
            DEFAULT_RETRY_DELAY_MILLISECONDS,
        );
      }
    }
  }

  private async recordStarts(pending: PendingStarts): Promise<void> {
    const access = await this.authorize(pending);

    if (access === null) {
      return;
    }

    const announceable = Array.from(pending.steps.values()).filter((step) =>
      this.isAnnounceable(step, access.flow),
    );

    for (const group of groupByTransition(announceable)) {
      await this.store({
        runId: pending.runId,
        accountId: pending.accountId,
        planId: pending.planId,
        type: PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED,
        observedAt: pending.observedAt,
        candidates: toCandidates(group, access.flow),
        reason: null,
        registrations: access.registrations,
      });
    }
  }

  private async recordEnding(
    identity: RunIdentity,
    outcome: {
      readonly ending: AgentPlanRunEnding;
      readonly reason: string | null;
    },
    observedAt: Date,
  ): Promise<void> {
    const access = await this.authorize(identity);

    if (access === null) {
      return;
    }

    await this.store({
      runId: identity.runId,
      accountId: identity.accountId,
      planId: identity.planId,
      type: ENDING_EVENT[outcome.ending],
      observedAt,
      candidates: [{ key: "ended", steps: [] }],
      reason: outcome.reason,
      registrations: access.registrations,
    });
  }

  /** Finds the devices of the run's account and proves plan ownership and run rights. */
  private async authorize(identity: RunIdentity): Promise<Authorized | null> {
    if (
      ![identity.accountId, identity.planId, identity.runId].every(
        isSafeIdentifier,
      )
    ) {
      return null;
    }

    const registrations = await this.options.registrations.listActivated(
      identity.accountId,
    );

    if (registrations.length === 0) {
      return null;
    }

    const access = await this.options.runs.read(
      identity.accountId,
      identity.runId,
    );

    return access.status === "granted"
      ? { flow: access.flow, registrations }
      : null;
  }

  private isAnnounceable(
    step: AgentPlanStartedStep,
    flow: AgentPlanRunFlow,
  ): boolean {
    if (step.loopId !== null) {
      // The first iteration begins with the loop itself, which is announced as the step.
      return step.iteration !== null && step.iteration > 1;
    }

    return flow.isStep(step.stepId) && !flow.isEntry(step.stepId);
  }

  private async store(write: StoreRequest): Promise<void> {
    const occurredAt = write.observedAt.toISOString();
    const deviceIds = write.registrations
      .filter((registration) => registration.registeredAt <= occurredAt)
      .map((registration) => registration.deviceId);

    if (deviceIds.length === 0 || write.candidates.length === 0) {
      return;
    }

    const stored = await this.options.events.record(
      {
        accountId: write.accountId,
        planId: write.planId,
        runId: write.runId,
        type: write.type,
        occurredAt,
        candidates: write.candidates,
        reason: write.reason,
        deviceIds,
        expiresAt: new Date(
          write.observedAt.getTime() + this.options.replayTtlSeconds * 1000,
        ).toISOString(),
      },
      this.now().toISOString(),
    );

    if (stored !== null) {
      this.options.onRecorded();
    }
  }
}
