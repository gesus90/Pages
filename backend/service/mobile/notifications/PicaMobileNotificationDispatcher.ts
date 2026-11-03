import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { PICA_MOBILE_NOTIFICATION_EVENT_TYPE } from "@/definition/PicaMobileNotifications";

import { buildPicaMobilePushMessage } from "./PicaMobilePushMessage";
import { findStepName } from "./PicaMobileRunNames";

import type { DeliveryRecord } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import type { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import type {
  PicaMobileNotificationEventRepository,
  StoredNotificationEvent,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import type {
  PicaMobilePushRegistrationRepository,
  PushRegistrationRecord,
} from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type { AgentPlanOwnerRunAccess } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { PicaMobileAccountChecks } from "./PicaMobileAccountChecks";
import type { PicaMobilePushDetails } from "./PicaMobilePushMessage";
import type {
  PicaMobilePushOutcome,
  PicaMobilePushSender,
} from "./PicaMobilePushSender";
import type { PicaMobilePushTokenVault } from "./PicaMobilePushTokenVault";

/** What the dispatcher is created with. */
export interface PicaMobileNotificationDispatcherOptions {
  readonly deliveries: PicaMobileNotificationDeliveryRepository;
  readonly events: Pick<
    PicaMobileNotificationEventRepository,
    "find" | "prune"
  >;
  readonly registrations: Pick<
    PicaMobilePushRegistrationRepository,
    "find" | "listAll" | "removeBinding"
  >;
  readonly runs: Pick<AgentPlanOwnerRunReader, "read">;
  readonly accounts: PicaMobileAccountChecks;
  readonly vault: Pick<PicaMobilePushTokenVault, "decrypt">;
  /** `null` while no sender is configured: pending pushes then only wait out their validity. */
  readonly sender: PicaMobilePushSender | null;
  readonly instanceId: () => Promise<string>;
  readonly now?: () => Date;
}

type GrantedAccess = Extract<AgentPlanOwnerRunAccess, { status: "granted" }>;

interface ReadyDelivery {
  readonly kind: "ready";
  readonly registration: PushRegistrationRecord;
  readonly event: StoredNotificationEvent;
  readonly access: GrantedAccess;
  readonly token: string;
}

type Decision =
  | ReadyDelivery
  | {
      readonly kind: "drop";
      readonly outcome: string;
      /** The registration to remove with it, when the cause lies in the binding. */
      readonly remove?: PushRegistrationRecord;
    }
  | { readonly kind: "defer"; readonly until: Date };

const COMPONENT = "PicaMobileNotificationDispatcher";
const BATCH_SIZE = 20;
const CONCURRENCY = 4;
const LOCK_MILLISECONDS = 120_000;
const TICK_GAP_MILLISECONDS = 250;
const IDLE_MILLISECONDS = 30_000;
const MAINTENANCE_MILLISECONDS = 300_000;
const STEP_PUSH_GAP_MILLISECONDS = 10_000;
const MAXIMUM_ATTEMPTS = 6;
const RETRY_BACKOFF_SECONDS: readonly number[] = [5, 15, 45, 120, 300];
const UNAVAILABLE_MINIMUM_SECONDS = 60;
const EVENT_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const DELIVERY_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAXIMUM_EVENTS_PER_ACCOUNT = 100;
const STOP_WAIT_MILLISECONDS = 5_000;

function retryDelaySeconds(
  attempts: number,
  hint: number | undefined,
  minimum: number,
): number {
  const step = Math.min(Math.max(attempts, 1), RETRY_BACKOFF_SECONDS.length);
  const base = RETRY_BACKOFF_SECONDS[step - 1] ?? 300;
  // Jitter keeps many deliveries that failed together from retrying together.
  const jittered = base * (0.8 + Math.random() * 0.4);

  return Math.max(minimum, hint ?? 0, jittered);
}

async function runLimited<Item>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (let index = next++; index < items.length; index = next++) {
        const item = items[index];

        if (item !== undefined) {
          await task(item);
        }
      }
    },
  );

  await Promise.all(workers);
}

function toDetails(
  event: StoredNotificationEvent,
  access: GrantedAccess,
): PicaMobilePushDetails {
  const steps = event.steps ?? [];

  return {
    planName: access.plan.name,
    steps: steps.map((step) => ({
      number: step.number,
      name: findStepName(access.run, step),
    })),
    stepCount: event.stepCount ?? steps.length,
    reason: event.reason,
  };
}

/**
 * Sends the pending pushes of the outbox.
 *
 * @remarks
 * It runs beside the execution of plans and never in its path: a slow, failing
 * or unconfigured push service changes no run, starts no job and blocks
 * nothing. Immediately before every attempt it checks again that the
 * registration still holds, that its session and account are in good standing
 * and that the account still owns the plan and may read the run. Attempts stop
 * when the validity of the push is over. A transient failure is retried a few
 * times with growing waits; a token the push service refuses ends only its own
 * registration. A step push is held back so a run sends at most one every ten
 * seconds, and a terminal push is never held back for that.
 */
export class PicaMobileNotificationDispatcher {
  private readonly options: PicaMobileNotificationDispatcherOptions;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private timerDueAt = 0;
  private running: Promise<void> | null = null;
  private lastMaintenanceAt = 0;
  private isSenderBlocked = false;
  private isStopped = false;

  /**
   * Creates the dispatcher; it sends once {@link PicaMobileNotificationDispatcher.start} ran.
   *
   * @param options - Storage, rights checks and the sender.
   */
  public constructor(options: PicaMobileNotificationDispatcherOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  /** Starts working through what is pending, then keeps watching. */
  public start(): void {
    this.schedule(0);
  }

  /** Tells the dispatcher that new pushes are waiting. */
  public kick(): void {
    this.schedule(0);
  }

  /**
   * Stops taking new work and waits for the pass that is running.
   *
   * @remarks
   * It waits a few seconds at most, so a push service that hangs cannot hold
   * up the shutdown of Pages. A send that is still under way when the
   * database closes ends with a logged error; its delivery is handed out
   * again after the next start if its validity has not run out.
   */
  public async stop(): Promise<void> {
    this.isStopped = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.running !== null) {
      await Promise.race([
        this.running,
        new Promise<void>((resolve) => {
          setTimeout(resolve, STOP_WAIT_MILLISECONDS).unref();
        }),
      ]);
    }
  }

  private schedule(delayMilliseconds: number): void {
    if (this.isStopped) {
      return;
    }

    const dueAt = this.now().getTime() + delayMilliseconds;

    if (this.timer !== null) {
      if (this.timerDueAt <= dueAt) {
        return;
      }

      clearTimeout(this.timer);
    }

    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => this.wake(), delayMilliseconds);
    this.timer.unref();
  }

  private wake(): void {
    this.timer = null;

    if (this.running !== null) {
      this.schedule(TICK_GAP_MILLISECONDS);

      return;
    }

    // Whoever scheduled this pass, it delivers for every account.
    this.running = withBackgroundDatabaseWork("pica_mobile_dispatch", () =>
      this.pass(),
    );
  }

  private async pass(): Promise<void> {
    let handled = 0;

    try {
      handled = await this.work();
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    } finally {
      this.running = null;
    }

    await this.scheduleNext(handled);
  }

  private async scheduleNext(handled: number): Promise<void> {
    if (handled > 0) {
      this.schedule(TICK_GAP_MILLISECONDS);

      return;
    }

    try {
      const due =
        this.options.sender === null || this.isSenderBlocked
          ? null
          : await this.options.deliveries.nextDueAt();
      const wait =
        due === null
          ? IDLE_MILLISECONDS
          : Date.parse(due) - this.now().getTime();

      this.schedule(
        Math.min(Math.max(wait, TICK_GAP_MILLISECONDS), IDLE_MILLISECONDS),
      );
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      this.schedule(IDLE_MILLISECONDS);
    }
  }

  private async work(): Promise<number> {
    const { deliveries, sender } = this.options;
    const moment = this.now();
    const now = moment.toISOString();
    let handled = 0;

    if ((await deliveries.nextDueAt()) !== null) {
      await deliveries.releaseExpiredLocks(now);
      await deliveries.expireDue(now);

      // Credentials come first: a rights check must not be followed by a slow token request.
      this.isSenderBlocked = sender !== null && !(await sender.ready());

      if (sender !== null && !this.isSenderBlocked) {
        const claimed = await deliveries.claimDue(
          now,
          new Date(moment.getTime() + LOCK_MILLISECONDS).toISOString(),
          BATCH_SIZE,
        );

        await runLimited(claimed, CONCURRENCY, (delivery) =>
          this.deliver(delivery),
        );
        handled = claimed.length;
      }
    }

    if (moment.getTime() - this.lastMaintenanceAt >= MAINTENANCE_MILLISECONDS) {
      this.lastMaintenanceAt = moment.getTime();
      await this.maintain(moment);
    }

    return handled;
  }

  private async maintain(moment: Date): Promise<void> {
    // One failing step must not keep the other from running.
    try {
      await this.sweepRegistrations(moment.toISOString());
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }

    try {
      await this.options.events.prune({
        eventsBefore: new Date(
          moment.getTime() - EVENT_RETENTION_MILLISECONDS,
        ).toISOString(),
        deliveriesBefore: new Date(
          moment.getTime() - DELIVERY_RETENTION_MILLISECONDS,
        ).toISOString(),
        maximumEventsPerAccount: MAXIMUM_EVENTS_PER_ACCOUNT,
      });
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }

  /** Removes the registrations whose session or account no longer holds. */
  private async sweepRegistrations(now: string): Promise<void> {
    for (const registration of await this.options.registrations.listAll()) {
      if (
        !(await this.options.accounts.isBindingValid(
          registration.accountId,
          registration.sessionId,
        ))
      ) {
        await this.options.registrations.removeBinding(registration, now);
      }
    }
  }

  private async deliver(delivery: DeliveryRecord): Promise<void> {
    try {
      await this.apply(delivery, await this.prepare(delivery));
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      try {
        await this.retryOrEnd(delivery, { reason: "undecided" });
      } catch (secondary: unknown) {
        // The lock runs out and hands the delivery out again.
        logCaughtError(COMPONENT, secondary);
      }
    }
  }

  /** Checks everything that can have changed since the event was stored. */
  private async prepare(delivery: DeliveryRecord): Promise<Decision> {
    const { registrations, events, accounts, runs, vault } = this.options;
    // The cheap checks that end or defer a delivery come before the expensive rights read.
    const deferral = await this.holdBack(delivery);

    if (deferral !== null) {
      return deferral;
    }

    const registration = await registrations.find(delivery.deviceId);

    if (
      registration === null ||
      registration.accountId !== delivery.accountId ||
      registration.activatedAt === null
    ) {
      return { kind: "drop", outcome: "registration_missing" };
    }

    const event = await events.find(delivery.eventId);

    if (event === null) {
      return { kind: "drop", outcome: "event_missing" };
    }

    if (event.occurredAt < registration.registeredAt) {
      return { kind: "drop", outcome: "before_registration" };
    }

    if (await this.isReplaced(delivery)) {
      return { kind: "drop", outcome: "replaced_by_newer_event" };
    }

    if (
      !(await accounts.isBindingValid(
        registration.accountId,
        registration.sessionId,
      ))
    ) {
      return { kind: "drop", outcome: "session_ended", remove: registration };
    }

    const access = await runs.read(delivery.accountId, delivery.runId);

    if (access.status !== "granted") {
      return { kind: "drop", outcome: "rights_revoked" };
    }

    const token = vault.decrypt(
      registration.deviceId,
      registration.tokenEncrypted,
    );

    return token === null
      ? { kind: "drop", outcome: "token_unreadable", remove: registration }
      : { kind: "ready", registration, event, access, token };
  }

  /** A progress push is stale once a newer push of the same run exists for the device. */
  private async isReplaced(delivery: DeliveryRecord): Promise<boolean> {
    return (
      delivery.eventType === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED &&
      (await this.options.deliveries.hasNewerDelivery(
        delivery.runId,
        delivery.deviceId,
        delivery.seq,
      ))
    );
  }

  /** A run sends at most one step push every ten seconds to a device. */
  private async holdBack(delivery: DeliveryRecord): Promise<Decision | null> {
    if (
      delivery.eventType !== PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED
    ) {
      return null;
    }

    const last = await this.options.deliveries.lastStepPushAt(
      delivery.runId,
      delivery.deviceId,
    );

    if (last === null) {
      return null;
    }

    const until = Date.parse(last) + STEP_PUSH_GAP_MILLISECONDS;

    return until > this.now().getTime()
      ? { kind: "defer", until: new Date(until) }
      : null;
  }

  private async apply(
    delivery: DeliveryRecord,
    decision: Decision,
  ): Promise<void> {
    const now = this.now().toISOString();

    if (decision.kind === "drop") {
      if (decision.remove !== undefined) {
        await this.options.registrations.removeBinding(decision.remove, now);
      }

      await this.end(delivery, "dropped", decision.outcome);
    } else if (decision.kind === "defer") {
      await this.deferOrExpire(delivery, decision.until);
    } else {
      await this.send(delivery, decision);
    }
  }

  private async deferOrExpire(
    delivery: DeliveryRecord,
    until: Date,
  ): Promise<void> {
    if (until.getTime() >= Date.parse(delivery.expiresAt)) {
      await this.end(delivery, "expired", "validity_elapsed");

      return;
    }

    await this.options.deliveries.requeue(
      delivery.deliveryId,
      until.toISOString(),
      "held_back",
      false,
    );
  }

  private async send(
    delivery: DeliveryRecord,
    ready: ReadyDelivery,
  ): Promise<void> {
    const { sender } = this.options;
    const remainingMilliseconds =
      Date.parse(delivery.expiresAt) - this.now().getTime();

    if (sender === null || remainingMilliseconds < 1000) {
      await this.end(delivery, "expired", "validity_elapsed");

      return;
    }

    const { registration, event, access, token } = ready;
    const message = buildPicaMobilePushMessage({
      token,
      instanceId: await this.options.instanceId(),
      event: {
        eventId: event.eventId,
        accountId: event.accountId,
        planId: event.planId,
        runId: event.runId,
        type: event.type,
        seq: event.seq,
        occurredAt: event.occurredAt,
      },
      locale: registration.locale,
      details:
        registration.preview === "details" ? toDetails(event, access) : null,
      ttlSeconds: Math.floor(remainingMilliseconds / 1000),
    });

    await this.settle(delivery, registration, await sender.send(message));
  }

  private async settle(
    delivery: DeliveryRecord,
    registration: PushRegistrationRecord,
    outcome: PicaMobilePushOutcome,
  ): Promise<void> {
    switch (outcome.kind) {
      case "sent":
        await this.end(delivery, "sent", "accepted");

        return;
      case "invalidToken":
        await this.options.registrations.removeBinding(
          registration,
          this.now().toISOString(),
        );
        await this.end(delivery, "dropped", "token_invalid");

        return;
      case "rejected":
        await this.end(delivery, "failed", "rejected");

        return;
      case "retry":
        await this.retryOrEnd(delivery, {
          reason: "transient",
          hintSeconds: outcome.retryAfterSeconds,
        });

        return;
      case "unavailable":
        await this.retryOrEnd(delivery, {
          reason: "sender_unavailable",
          minimumSeconds: UNAVAILABLE_MINIMUM_SECONDS,
        });
    }
  }

  private async retryOrEnd(
    delivery: DeliveryRecord,
    cause: {
      readonly reason: string;
      readonly hintSeconds?: number;
      readonly minimumSeconds?: number;
    },
  ): Promise<void> {
    if (delivery.attempts >= MAXIMUM_ATTEMPTS) {
      await this.end(delivery, "failed", "retries_exhausted");

      return;
    }

    const delay = retryDelaySeconds(
      delivery.attempts,
      cause.hintSeconds,
      cause.minimumSeconds ?? 0,
    );
    const notBefore = new Date(this.now().getTime() + delay * 1000);

    if (notBefore.getTime() >= Date.parse(delivery.expiresAt)) {
      await this.end(delivery, "expired", "validity_elapsed");

      return;
    }

    await this.options.deliveries.requeue(
      delivery.deliveryId,
      notBefore.toISOString(),
      cause.reason,
      true,
    );
  }

  private async end(
    delivery: DeliveryRecord,
    end: "sent" | "failed" | "dropped" | "expired",
    outcome: string,
  ): Promise<void> {
    await this.options.deliveries.finish(
      delivery.deliveryId,
      end,
      outcome,
      this.now().toISOString(),
    );
    logEvent({
      level: end === "failed" ? "warn" : "debug",
      event: "pica_mobile.notifications.delivery_ended",
      component: COMPONENT,
      message: "Pica Mobile push delivery ended",
      metadata: { reason: outcome, status: end, eventType: delivery.eventType },
    });
  }
}
