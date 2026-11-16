import { expect, it, vi } from "vitest";

import { PicaMobileAutomationPush } from "@/backend/service/mobile/notifications/PicaMobileAutomationPush";
import { PicaMobileNotificationAccess } from "@/backend/service/mobile/notifications/PicaMobileNotificationAccess";
import { PicaMobileRunPausedPush } from "@/backend/service/mobile/notifications/PicaMobileRunPausedPush";
import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { NotificationPreferenceRecord } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import type { PushRegistrationRecord } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type {
  AgentPlanOwnerRunAccess,
  AgentPlanRunRelation,
} from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { PicaMobilePushMessage } from "@/backend/service/mobile/notifications/PicaMobilePushSender";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  NotificationChoices,
  PicaMobileNotificationLocale,
  PicaMobileNotificationPreview,
} from "@/definition/PicaMobileNotifications";

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (name: string, work: () => Promise<void>) => {
    void name;
    return work();
  },
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const NOW = new Date("2026-03-01T12:00:00.000Z");
const TEAM_SINCE = "2026-01-01T00:00:00.000Z";

function planRun(
  status: AgentPlanRun["status"],
  overrides: Partial<AgentPlanRun> = {},
): AgentPlanRun {
  return partial<AgentPlanRun>({
    id: "run-1",
    planId: "plan-1",
    userId: "owner",
    status,
    steps: [],
    loops: [],
    stopRequested: false,
    pauseBoundary: {
      pausedAt: NOW.toISOString(),
      completedStepIds: [],
      pendingStepIds: [],
      frontierStepIds: [],
    },
    ...overrides,
  });
}

function registration(
  overrides: Partial<PushRegistrationRecord> = {},
): PushRegistrationRecord {
  return {
    deviceId: "device-owner",
    accountId: "owner",
    sessionId: "session-1",
    tokenFingerprint: "fingerprint-1",
    tokenEncrypted: "sealed-owner",
    locale: "de",
    preview: "details",
    registeredAt: "2026-01-01T00:00:00.000Z",
    renewedAt: "2026-02-01T00:00:00.000Z",
    activatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function preference(
  accountId: string,
  change: Partial<NotificationChoices> = {},
): NotificationPreferenceRecord {
  return {
    accountId,
    ...DEFAULT_NOTIFICATION_CHOICES,
    teamRuns: true,
    teamRunsSince: TEAM_SINCE,
    ...change,
  };
}

function granted(
  relation: AgentPlanRunRelation,
  planName = "Nightly build",
): AgentPlanOwnerRunAccess {
  return partial<AgentPlanOwnerRunAccess>({
    status: "granted",
    relation,
    run: planRun("paused"),
    plan: { id: "plan-1", name: planName },
    flow: {},
  });
}

interface WorldOptions {
  readonly registrations?: readonly PushRegistrationRecord[];
  readonly choices?: Partial<NotificationChoices>;
  readonly teamRecipients?: readonly NotificationPreferenceRecord[];
  readonly access?: (accountId: string) => AgentPlanOwnerRunAccess;
  readonly preview?: PicaMobileNotificationPreview;
  readonly locale?: PicaMobileNotificationLocale;
}

interface World {
  readonly push: PicaMobileRunPausedPush;
  readonly sent: PicaMobilePushMessage[];
}

function world(options: WorldOptions = {}): World {
  const sent: PicaMobilePushMessage[] = [];
  const registrations = options.registrations ?? [
    registration({
      preview: options.preview ?? "details",
      locale: options.locale ?? "de",
    }),
  ];
  const find = vi.fn(async (accountId: string) =>
    preference(accountId, options.choices),
  );
  const reader = {
    read: async (accountId: string) =>
      options.access?.(accountId) ??
      granted(accountId === "owner" ? "starter" : "team"),
  };
  const access = new PicaMobileNotificationAccess(reader, { find });
  const delivery = new PicaMobileAutomationPush({
    registrations: {
      listActivated: async (userId) =>
        registrations.filter((entry) => entry.accountId === userId),
    },
    accounts: { isBindingValid: () => Promise.resolve(true) },
    vault: { decrypt: (deviceId) => `token-${deviceId}` },
    sender: {
      ready: () => Promise.resolve(true),
      send: (message) => {
        sent.push(message);
        return Promise.resolve({ kind: "sent" });
      },
    },
    instanceId: () => Promise.resolve("instance-1"),
    ttlSeconds: 600,
  });
  const push = new PicaMobileRunPausedPush({
    runs: access,
    preferences: {
      find,
      listTeamRecipients: async () => [...(options.teamRecipients ?? [])],
    },
    push: delivery,
    now: () => NOW,
  });

  return { push, sent };
}

it("announces only the write that reaches paused", () => {
  const { push } = world();
  const notify = vi.spyOn(push, "notify").mockResolvedValue(undefined);

  push.runChanged(planRun("running"), planRun("pausing"));
  push.runChanged(planRun("pausing"), planRun("paused"));
  push.runChanged(planRun("paused"), planRun("paused"));
  push.runChanged(planRun("paused"), planRun("running"));

  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ status: "paused" }),
  );
});

it("sends the run_paused push on the plan results channel with the plan name", async () => {
  const { push, sent } = world();

  await push.notify(planRun("paused"));

  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    token: "token-device-owner",
    title: "Plan pausiert",
    body: "Nightly build",
    channelId: "pica-plan-results",
    ttlSeconds: 600,
    data: {
      pica_v: "1",
      pica_type: "run_paused",
      pica_instance: "instance-1",
      pica_account: "owner",
      pica_plan: "plan-1",
      pica_run: "run-1",
      pica_at: NOW.toISOString(),
    },
  });
  expect(sent[0]?.tag).toBe(`run:run-1:paused:${NOW.toISOString()}`);
});

it("hides the plan name while the preview is off and words the title in English", async () => {
  const hidden = world({ preview: "hidden" });
  await hidden.push.notify(planRun("paused"));
  expect(hidden.sent[0]).toMatchObject({
    title: "Plan pausiert",
    body: "Zum Anzeigen der Details entsperren.",
  });
  expect(JSON.stringify(hidden.sent[0])).not.toContain("Nightly build");

  const english = world({ locale: "en" });
  await english.push.notify(planRun("paused"));
  expect(english.sent[0]).toMatchObject({
    title: "Plan paused",
    body: "Nightly build",
  });
});

it("sends nothing without the main switch or the interruption kind", async () => {
  const off = world({ choices: { receiveNotifications: false } });
  await off.push.notify(planRun("paused"));
  expect(off.sent).toEqual([]);

  const interruptionsOff = world({ choices: { planInterruptions: false } });
  await interruptionsOff.push.notify(planRun("paused"));
  expect(interruptionsOff.sent).toEqual([]);

  const allStatuses = world({
    choices: { planInterruptions: false, planAllStatuses: true },
  });
  await allStatuses.push.notify(planRun("paused"));
  expect(allStatuses.sent).toHaveLength(1);
});

it("sends nothing when the account may not read the run", async () => {
  const { push, sent } = world({
    access: () => partial<AgentPlanOwnerRunAccess>({ status: "denied" }),
  });

  await push.notify(planRun("paused"));

  expect(sent).toEqual([]);
});

it("reaches the starter and an authorized team member, each on its own device", async () => {
  const { push, sent } = world({
    registrations: [
      registration(),
      registration({
        deviceId: "device-member",
        accountId: "member",
        sessionId: "session-2",
        tokenEncrypted: "sealed-member",
      }),
    ],
    teamRecipients: [preference("member")],
  });

  await push.notify(planRun("paused"));

  expect(sent).toHaveLength(2);
  expect(sent.map((message) => message.token).sort()).toEqual([
    "token-device-member",
    "token-device-owner",
  ]);
  expect(sent.map((message) => message.data["pica_account"]).sort()).toEqual([
    "member",
    "owner",
  ]);
});

it("sends two pushes for pause, resume, pause and none for the resume", async () => {
  const { push, sent } = world();

  push.runChanged(planRun("running"), planRun("pausing"));
  push.runChanged(planRun("pausing"), planRun("paused"));
  push.runChanged(planRun("paused"), planRun("running"));
  push.runChanged(
    planRun("running"),
    planRun("pausing", { pauseBoundary: undefined }),
  );
  push.runChanged(
    planRun("pausing", { pauseBoundary: undefined }),
    planRun("paused", {
      pauseBoundary: {
        pausedAt: "2026-03-01T12:05:00.000Z",
        completedStepIds: [],
        pendingStepIds: [],
        frontierStepIds: [],
      },
    }),
  );

  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[0]?.tag).not.toBe(sent[1]?.tag);
});
