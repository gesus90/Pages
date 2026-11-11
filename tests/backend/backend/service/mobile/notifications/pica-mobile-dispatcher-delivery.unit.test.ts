import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import {
  NOW,
  at,
  createHarness,
  delivery,
  registration,
  storedEvent,
} from "./pica-mobile-dispatcher-fixture";

import type { DeliveryRecord } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import type { StoredNotificationEvent } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import type {
  PicaMobilePushMessage,
  PicaMobilePushOutcome,
} from "@/backend/service/mobile/notifications/PicaMobilePushSender";
import type {
  DispatcherHarness,
  HarnessChoices,
} from "./pica-mobile-dispatcher-fixture";

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (workName: string, work: () => Promise<void>) =>
    work(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/runtime/ServiceWorkHealth", () => ({
  recordServiceProgress: vi.fn(),
}));

const COMPONENT = "PicaMobileNotificationDispatcher";

/** Runs one pass over the claimed delivery and stops the dispatcher. */
async function deliverOnce(
  claimed: DeliveryRecord,
  choices: HarnessChoices = {},
  prepare: (harness: DispatcherHarness) => void = () => undefined,
): Promise<DispatcherHarness> {
  const harness = createHarness(choices);
  harness.deliveries.claimDue.mockResolvedValueOnce([claimed]);
  prepare(harness);
  harness.dispatcher.start();
  await vi.advanceTimersByTimeAsync(0);
  await harness.dispatcher.stop();

  return harness;
}

/** The one message the dispatcher handed to the sender. */
function sentMessage(harness: DispatcherHarness): PicaMobilePushMessage {
  expect(harness.sender.send).toHaveBeenCalledOnce();

  return harness.sender.send.mock.calls[0][0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.mocked(logCaughtError).mockClear();
  vi.mocked(logEvent).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function step(
  stepId: string,
  overrides: Partial<
    NonNullable<StoredNotificationEvent["steps"]>[number]
  > = {},
): NonNullable<StoredNotificationEvent["steps"]>[number] {
  return {
    instanceId: `instance-${stepId}`,
    stepId,
    loopId: null,
    number: 1,
    attempt: 1,
    iteration: null,
    ...overrides,
  };
}

it("sends a generic push with the validity that is left and the rights read at the time of the event", async () => {
  const harness = await deliverOnce(delivery());

  expect(harness.registrations.find).toHaveBeenCalledWith("device-1");
  expect(harness.events.find).toHaveBeenCalledWith("event-1");
  expect(harness.accounts.isBindingValid).toHaveBeenCalledWith(
    "account-1",
    "session-1",
  );
  expect(harness.runs.read).toHaveBeenCalledWith(
    "account-1",
    "run-1",
    at(-60_000),
  );
  expect(harness.vault.decrypt).toHaveBeenCalledWith(
    "device-1",
    "encrypted-token",
  );
  expect(sentMessage(harness)).toEqual({
    token: "native-token",
    title: "Agent plan completed successfully",
    body: "Unlock to view details.",
    data: {
      pica_v: "1",
      pica_event: "event-1",
      pica_instance: "instance-1",
      pica_account: "account-1",
      pica_type: "run_succeeded",
      pica_plan: "plan-1",
      pica_run: "run-1",
      pica_seq: "3",
      pica_at: at(-60_000),
      tag: "event-1",
    },
    channelId: "pica-plan-results",
    tag: "event-1",
    ttlSeconds: 3600,
  });
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "sent",
    "accepted",
    at(0),
  );
  expect(logEvent).toHaveBeenCalledWith({
    level: "debug",
    event: "pica_mobile.notifications.delivery_ended",
    component: COMPONENT,
    message: "Pica Mobile push delivery ended",
    metadata: {
      reason: "accepted",
      status: "sent",
      eventType: "run_succeeded",
    },
  });
});

it("names the plan and the failure reason for a device that asked for details", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "run_failed" }),
    {},
    (prepared) => {
      prepared.registrations.find.mockResolvedValue(
        registration({ preview: "details" }),
      );
      prepared.events.find.mockResolvedValue(
        storedEvent({ type: "run_failed", reason: "Out of disk" }),
      );
    },
  );

  expect(sentMessage(harness)).toMatchObject({
    title: "Plan failed",
    body: "Nightly build · Out of disk",
  });
});

it("names the current step of a plain step in the language of the device", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started" }),
    {},
    (prepared) => {
      prepared.registrations.find.mockResolvedValue(
        registration({ preview: "details", locale: "de" }),
      );
      prepared.events.find.mockResolvedValue(
        storedEvent({
          type: "step_started",
          steps: [step("step-a", { number: 1 })],
        }),
      );
    },
  );

  expect(sentMessage(harness)).toMatchObject({
    title: "Nächster Schritt",
    body: "Nightly build · Schritt 1: Compile",
    channelId: "pica-plan-steps",
    tag: "run:run-1:step",
  });
});

it("finds the name of a loop member by its iteration", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started" }),
    {},
    (prepared) => {
      prepared.registrations.find.mockResolvedValue(
        registration({ preview: "details" }),
      );
      prepared.events.find.mockResolvedValue(
        storedEvent({
          type: "step_started",
          steps: [
            step("step-b", { loopId: "loop-1", iteration: 2, number: 4 }),
          ],
        }),
      );
    },
  );

  expect(sentMessage(harness).body).toBe("Nightly build · Step 4: Lint");
});

it("counts the started steps when the event stored more than it names", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started" }),
    {},
    (prepared) => {
      prepared.registrations.find.mockResolvedValue(
        registration({ preview: "details" }),
      );
      prepared.events.find.mockResolvedValue(
        storedEvent({
          type: "step_started",
          steps: [step("step-a"), step("step-gone", { number: 2 })],
          stepCount: 5,
        }),
      );
    },
  );

  expect(sentMessage(harness).body).toBe("Nightly build · 5 steps started");
});

it("shows no step name once the run no longer has the step", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started" }),
    {},
    (prepared) => {
      prepared.registrations.find.mockResolvedValue(
        registration({ preview: "details" }),
      );
      prepared.events.find.mockResolvedValue(
        storedEvent({
          type: "step_started",
          steps: [step("step-gone", { number: 7 })],
        }),
      );
    },
  );

  expect(sentMessage(harness).body).toBe("Nightly build · Step 7");
});

interface DropCase {
  readonly name: string;
  readonly outcome: string;
  readonly isBindingRemoved: boolean;
  readonly claimed?: Partial<DeliveryRecord>;
  readonly prepare: (harness: DispatcherHarness) => void;
}

const DROP_CASES: readonly DropCase[] = [
  {
    name: "the registration is gone",
    outcome: "registration_missing",
    isBindingRemoved: false,
    prepare: (harness) => harness.registrations.find.mockResolvedValue(null),
  },
  {
    name: "the device now belongs to another account",
    outcome: "registration_missing",
    isBindingRemoved: false,
    prepare: (harness) =>
      harness.registrations.find.mockResolvedValue(
        registration({ accountId: "account-2" }),
      ),
  },
  {
    name: "the registration was never activated",
    outcome: "registration_missing",
    isBindingRemoved: false,
    prepare: (harness) =>
      harness.registrations.find.mockResolvedValue(
        registration({ activatedAt: null }),
      ),
  },
  {
    name: "the event was pruned",
    outcome: "event_missing",
    isBindingRemoved: false,
    prepare: (harness) => harness.events.find.mockResolvedValue(null),
  },
  {
    name: "the event is older than the registration",
    outcome: "before_registration",
    isBindingRemoved: false,
    prepare: (harness) =>
      harness.registrations.find.mockResolvedValue(
        registration({ registeredAt: at(-30_000) }),
      ),
  },
  {
    name: "a newer step push of the run exists",
    outcome: "replaced_by_newer_event",
    isBindingRemoved: false,
    claimed: { eventType: "step_started" },
    prepare: (harness) =>
      harness.deliveries.hasNewerDelivery.mockResolvedValue(true),
  },
  {
    name: "the session of the registration ended",
    outcome: "session_ended",
    isBindingRemoved: true,
    prepare: (harness) =>
      harness.accounts.isBindingValid.mockResolvedValue(false),
  },
  {
    name: "the account lost the right to the run",
    outcome: "rights_revoked",
    isBindingRemoved: false,
    prepare: (harness) =>
      harness.runs.read.mockResolvedValue({ status: "denied" }),
  },
  {
    name: "the run no longer exists",
    outcome: "rights_revoked",
    isBindingRemoved: false,
    prepare: (harness) =>
      harness.runs.read.mockResolvedValue({ status: "gone" }),
  },
  {
    name: "the stored token cannot be decrypted",
    outcome: "token_unreadable",
    isBindingRemoved: true,
    prepare: (harness) => harness.vault.decrypt.mockReturnValue(null),
  },
];

it.each(DROP_CASES)(
  "drops the push when $name",
  async ({ outcome, isBindingRemoved, claimed, prepare }) => {
    const harness = await deliverOnce(delivery(claimed), {}, prepare);

    expect(harness.sender.send).not.toHaveBeenCalled();
    expect(harness.deliveries.finish).toHaveBeenCalledWith(
      "delivery-1",
      "dropped",
      outcome,
      at(0),
    );
    if (isBindingRemoved) {
      expect(harness.registrations.removeBinding).toHaveBeenCalledWith(
        registration(),
        at(0),
      );
    } else {
      expect(harness.registrations.removeBinding).not.toHaveBeenCalled();
    }
  },
);

it("asks for a newer step push only for progress events", async () => {
  const progress = await deliverOnce(delivery({ eventType: "step_started" }));
  const terminal = await deliverOnce(delivery());

  expect(progress.deliveries.hasNewerDelivery).toHaveBeenCalledWith(
    "run-1",
    "device-1",
    3,
  );
  expect(terminal.deliveries.hasNewerDelivery).not.toHaveBeenCalled();
  expect(terminal.deliveries.lastStepPushAt).not.toHaveBeenCalled();
});

it("holds a step push back until ten seconds after the last one without a rights read", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started" }),
    {},
    (prepared) =>
      prepared.deliveries.lastStepPushAt.mockResolvedValue(at(-4_000)),
  );

  expect(harness.deliveries.lastStepPushAt).toHaveBeenCalledWith(
    "run-1",
    "device-1",
  );
  expect(harness.deliveries.requeue).toHaveBeenCalledWith(
    "delivery-1",
    at(6_000),
    "held_back",
    false,
  );
  expect(harness.registrations.find).not.toHaveBeenCalled();
  expect(harness.sender.send).not.toHaveBeenCalled();
});

it.each([
  ["exactly ten seconds ago", at(-10_000)],
  ["a minute ago", at(-60_000)],
])("sends a step push whose predecessor was sent %s", async (name, last) => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started" }),
    {},
    (prepared) => prepared.deliveries.lastStepPushAt.mockResolvedValue(last),
  );

  expect(harness.sender.send).toHaveBeenCalledOnce();
  expect(harness.deliveries.requeue).not.toHaveBeenCalled();
});

it("expires a held-back step push that would be due after its validity", async () => {
  const harness = await deliverOnce(
    delivery({ eventType: "step_started", expiresAt: at(5_000) }),
    {},
    (prepared) =>
      prepared.deliveries.lastStepPushAt.mockResolvedValue(at(-4_000)),
  );

  expect(harness.deliveries.requeue).not.toHaveBeenCalled();
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "expired",
    "validity_elapsed",
    at(0),
  );
});

it("expires a push whose validity is under a second instead of sending it", async () => {
  const harness = await deliverOnce(delivery({ expiresAt: at(999) }));

  expect(harness.sender.send).not.toHaveBeenCalled();
  expect(harness.instanceId).not.toHaveBeenCalled();
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "expired",
    "validity_elapsed",
    at(0),
  );
});

it("removes only the registration of a token the push service refuses", async () => {
  const harness = await deliverOnce(delivery(), {
    outcome: { kind: "invalidToken" },
  });

  expect(harness.registrations.removeBinding).toHaveBeenCalledWith(
    registration(),
    at(0),
  );
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "dropped",
    "token_invalid",
    at(0),
  );
});

it("fails a rejected message, keeps the registration and warns", async () => {
  const harness = await deliverOnce(delivery(), {
    outcome: { kind: "rejected" },
  });

  expect(harness.registrations.removeBinding).not.toHaveBeenCalled();
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "failed",
    "rejected",
    at(0),
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "warn",
      metadata: {
        reason: "rejected",
        status: "failed",
        eventType: "run_succeeded",
      },
    }),
  );
});

interface RetryCase {
  readonly name: string;
  readonly attempts: number;
  readonly outcome: PicaMobilePushOutcome;
  readonly delaySeconds: number;
  readonly reason: string;
}

const RETRY_CASES: readonly RetryCase[] = [
  {
    name: "waits five seconds after the first transient failure",
    attempts: 1,
    outcome: { kind: "retry" },
    delaySeconds: 5,
    reason: "transient",
  },
  {
    name: "counts a delivery without attempts as the first",
    attempts: 0,
    outcome: { kind: "retry" },
    delaySeconds: 5,
    reason: "transient",
  },
  {
    name: "waits longer after more attempts",
    attempts: 3,
    outcome: { kind: "retry" },
    delaySeconds: 45,
    reason: "transient",
  },
  {
    name: "stays at five minutes for the last allowed attempt",
    attempts: 5,
    outcome: { kind: "retry" },
    delaySeconds: 300,
    reason: "transient",
  },
  {
    name: "follows the wait the push service asked for",
    attempts: 1,
    outcome: { kind: "retry", retryAfterSeconds: 120 },
    delaySeconds: 120,
    reason: "transient",
  },
  {
    name: "waits at least a minute while the sender is unavailable",
    attempts: 1,
    outcome: { kind: "unavailable" },
    delaySeconds: 60,
    reason: "sender_unavailable",
  },
  {
    name: "keeps the backoff when it exceeds the minimum of an unavailable sender",
    attempts: 5,
    outcome: { kind: "unavailable" },
    delaySeconds: 300,
    reason: "sender_unavailable",
  },
];

it.each(RETRY_CASES)(
  "$name",
  async ({ attempts, outcome, delaySeconds, reason }) => {
    const harness = await deliverOnce(delivery({ attempts }), { outcome });

    expect(harness.deliveries.requeue).toHaveBeenCalledWith(
      "delivery-1",
      at(delaySeconds * 1000),
      reason,
      true,
    );
    expect(harness.deliveries.finish).not.toHaveBeenCalled();
  },
);

it("spreads the retry wait by up to twenty percent either way", async () => {
  vi.mocked(Math.random).mockReturnValue(0);
  const early = await deliverOnce(delivery({ attempts: 2 }), {
    outcome: { kind: "retry" },
  });
  vi.mocked(Math.random).mockReturnValue(1);
  const late = await deliverOnce(delivery({ attempts: 2 }), {
    outcome: { kind: "retry" },
  });

  expect(early.deliveries.requeue).toHaveBeenCalledWith(
    "delivery-1",
    at(12_000),
    "transient",
    true,
  );
  expect(late.deliveries.requeue).toHaveBeenCalledWith(
    "delivery-1",
    at(18_000),
    "transient",
    true,
  );
});

it("fails a delivery that used up its attempts", async () => {
  const harness = await deliverOnce(delivery({ attempts: 6 }), {
    outcome: { kind: "retry" },
  });

  expect(harness.deliveries.requeue).not.toHaveBeenCalled();
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "failed",
    "retries_exhausted",
    at(0),
  );
});

it("expires a retry that would fall after the validity of the push", async () => {
  const harness = await deliverOnce(delivery({ expiresAt: at(5_000) }), {
    outcome: { kind: "retry" },
  });

  expect(harness.deliveries.requeue).not.toHaveBeenCalled();
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "expired",
    "validity_elapsed",
    at(0),
  );
});

it("logs a failing check and retries the delivery as undecided", async () => {
  const failure = new Error("rights read failed");
  const harness = await deliverOnce(delivery(), {}, (prepared) =>
    prepared.runs.read.mockRejectedValue(failure),
  );

  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, failure);
  expect(harness.sender.send).not.toHaveBeenCalled();
  expect(harness.deliveries.requeue).toHaveBeenCalledWith(
    "delivery-1",
    at(5_000),
    "undecided",
    true,
  );
});

it("leaves the delivery to its lock when even the retry cannot be stored", async () => {
  const failure = new Error("sender crashed");
  const secondary = new Error("database gone");
  const harness = await deliverOnce(delivery(), {}, (prepared) => {
    prepared.sender.send.mockRejectedValue(failure);
    prepared.deliveries.requeue.mockRejectedValue(secondary);
  });

  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, failure);
  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, secondary);
  expect(harness.deliveries.finish).not.toHaveBeenCalled();
});

it("ends an undecided delivery as failed once its attempts are used up", async () => {
  const harness = await deliverOnce(delivery({ attempts: 6 }), {}, (prepared) =>
    prepared.events.find.mockRejectedValue(new Error("events unreadable")),
  );

  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "failed",
    "retries_exhausted",
    at(0),
  );
});
