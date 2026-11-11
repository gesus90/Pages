import { vi } from "vitest";

import { PicaMobileNotificationDispatcher } from "@/backend/service/mobile/notifications/PicaMobileNotificationDispatcher";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";
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
import type { PicaMobileAccountChecks } from "@/backend/service/mobile/notifications/PicaMobileAccountChecks";
import type { PicaMobileNotificationAccess } from "@/backend/service/mobile/notifications/PicaMobileNotificationAccess";
import type { PicaMobileNotificationDispatcherOptions } from "@/backend/service/mobile/notifications/PicaMobileNotificationDispatcher";
import type { PicaMobilePushTokenVault } from "@/backend/service/mobile/notifications/PicaMobilePushTokenVault";
import type {
  PicaMobilePushOutcome,
  PicaMobilePushSender,
} from "@/backend/service/mobile/notifications/PicaMobilePushSender";

/** The moment the fake clock of a dispatcher test starts at. */
export const NOW = new Date("2026-03-01T12:00:00.000Z");

/**
 * Formats a moment relative to {@link NOW}.
 *
 * @param offsetMilliseconds - Distance from `NOW`; negative is earlier.
 * @returns The ISO 8601 text.
 */
export function at(offsetMilliseconds: number): string {
  return new Date(NOW.getTime() + offsetMilliseconds).toISOString();
}

/**
 * Creates a handed-out delivery that is valid for another hour.
 *
 * @param overrides - Fields that differ from the defaults.
 * @returns The delivery.
 */
export function delivery(
  overrides: Partial<DeliveryRecord> = {},
): DeliveryRecord {
  return {
    deliveryId: "delivery-1",
    eventId: "event-1",
    deviceId: "device-1",
    accountId: "account-1",
    runId: "run-1",
    eventType: "run_succeeded",
    seq: 3,
    attempts: 1,
    expiresAt: at(3_600_000),
    ...overrides,
  };
}

/**
 * Creates an activated registration that existed before the event.
 *
 * @param overrides - Fields that differ from the defaults.
 * @returns The registration.
 */
export function registration(
  overrides: Partial<PushRegistrationRecord> = {},
): PushRegistrationRecord {
  return {
    deviceId: "device-1",
    accountId: "account-1",
    sessionId: "session-1",
    tokenFingerprint: "fingerprint-1",
    tokenEncrypted: "encrypted-token",
    locale: "en",
    preview: "hidden",
    registeredAt: at(-86_400_000),
    renewedAt: at(-3_600_000),
    activatedAt: at(-86_000_000),
    ...overrides,
  };
}

/**
 * Creates the stored event that belongs to {@link delivery}.
 *
 * @param overrides - Fields that differ from the defaults.
 * @returns The event.
 */
export function storedEvent(
  overrides: Partial<StoredNotificationEvent> = {},
): StoredNotificationEvent {
  return {
    eventId: "event-1",
    accountId: "account-1",
    planId: "plan-1",
    runId: "run-1",
    seq: 3,
    type: "run_succeeded",
    occurredAt: at(-60_000),
    steps: null,
    stepCount: null,
    reason: null,
    ...overrides,
  };
}

/**
 * Creates the granted view of a run with one step and one loop member.
 *
 * @returns The access, as the rights check hands it over.
 */
export function grantedAccess(): AgentPlanOwnerRunAccess {
  return partial<AgentPlanOwnerRunAccess>({
    status: "granted",
    relation: "starter",
    plan: { id: "plan-1", name: "Nightly build" },
    run: {
      steps: [{ id: "step-a", name: "Compile" }],
      loops: [
        {
          id: "loop-1",
          iterations: [{ number: 2, nodes: [{ id: "step-b", name: "Lint" }] }],
        },
      ],
    },
    flow: {},
  });
}

type DeliveryMethods = Pick<
  PicaMobileNotificationDeliveryRepository,
  | "claimDue"
  | "expireDue"
  | "finish"
  | "hasNewerDelivery"
  | "lastStepPushAt"
  | "nextDueAt"
  | "releaseExpiredLocks"
  | "requeue"
>;

/** A dispatcher together with the recording stand-ins of everything it talks to. */
export interface DispatcherHarness {
  readonly dispatcher: PicaMobileNotificationDispatcher;
  readonly deliveries: {
    [Name in keyof DeliveryMethods]: Mock<DeliveryMethods[Name]>;
  };
  readonly events: {
    readonly find: Mock<PicaMobileNotificationEventRepository["find"]>;
    readonly prune: Mock<PicaMobileNotificationEventRepository["prune"]>;
  };
  readonly registrations: {
    readonly find: Mock<PicaMobilePushRegistrationRepository["find"]>;
    readonly listAll: Mock<PicaMobilePushRegistrationRepository["listAll"]>;
    readonly removeBinding: Mock<
      PicaMobilePushRegistrationRepository["removeBinding"]
    >;
  };
  readonly runs: { readonly read: Mock<PicaMobileNotificationAccess["read"]> };
  readonly accounts: {
    readonly isBindingValid: Mock<PicaMobileAccountChecks["isBindingValid"]>;
  };
  readonly vault: {
    readonly decrypt: Mock<PicaMobilePushTokenVault["decrypt"]>;
  };
  readonly sender: {
    readonly ready: Mock<PicaMobilePushSender["ready"]>;
    readonly send: Mock<PicaMobilePushSender["send"]>;
  };
  readonly instanceId: Mock<() => Promise<string>>;
}

/** What a harness replaces of the dispatcher options. */
export interface HarnessChoices {
  readonly canDispatch?: () => boolean;
  readonly now?: () => Date;
  readonly hasSender?: boolean;
  readonly outcome?: PicaMobilePushOutcome;
}

/**
 * Builds a dispatcher whose collaborators let one `run_succeeded` push through.
 *
 * @param choices - What differs from that happy path.
 * @returns The dispatcher and its stand-ins, to be adjusted per test.
 */
export function createHarness(choices: HarnessChoices = {}): DispatcherHarness {
  const deliveries: DispatcherHarness["deliveries"] = {
    claimDue: vi.fn<DeliveryMethods["claimDue"]>(async () => [delivery()]),
    expireDue: vi.fn<DeliveryMethods["expireDue"]>(async () => undefined),
    finish: vi.fn<DeliveryMethods["finish"]>(async () => undefined),
    hasNewerDelivery: vi.fn<DeliveryMethods["hasNewerDelivery"]>(
      async () => false,
    ),
    lastStepPushAt: vi.fn<DeliveryMethods["lastStepPushAt"]>(async () => null),
    nextDueAt: vi.fn<DeliveryMethods["nextDueAt"]>(async () => at(0)),
    releaseExpiredLocks: vi.fn<DeliveryMethods["releaseExpiredLocks"]>(
      async () => undefined,
    ),
    requeue: vi.fn<DeliveryMethods["requeue"]>(async () => undefined),
  };
  const events: DispatcherHarness["events"] = {
    find: vi.fn(async () => storedEvent()),
    prune: vi.fn(async () => undefined),
  };
  const registrations: DispatcherHarness["registrations"] = {
    find: vi.fn(async () => registration()),
    listAll: vi.fn(async () => []),
    removeBinding: vi.fn(async () => undefined),
  };
  const runs: DispatcherHarness["runs"] = {
    read: vi.fn(async () => grantedAccess()),
  };
  const accounts: DispatcherHarness["accounts"] = {
    isBindingValid: vi.fn(async () => true),
  };
  const vault: DispatcherHarness["vault"] = {
    decrypt: vi.fn(() => "native-token"),
  };
  const sender: DispatcherHarness["sender"] = {
    ready: vi.fn(async () => true),
    send: vi.fn(async () => choices.outcome ?? { kind: "sent" as const }),
  };
  const instanceId = vi.fn(async () => "instance-1");
  const options: PicaMobileNotificationDispatcherOptions = {
    canDispatch: choices.canDispatch,
    now: choices.now,
    deliveries: partial<PicaMobileNotificationDeliveryRepository>(deliveries),
    events: partial<PicaMobileNotificationDispatcherOptions["events"]>(events),
    registrations:
      partial<PicaMobileNotificationDispatcherOptions["registrations"]>(
        registrations,
      ),
    runs,
    accounts: partial<PicaMobileAccountChecks>(accounts),
    vault,
    sender: choices.hasSender === false ? null : sender,
    instanceId,
  };

  return {
    dispatcher: new PicaMobileNotificationDispatcher(options),
    deliveries,
    events,
    registrations,
    runs,
    accounts,
    vault,
    sender,
    instanceId,
  };
}
