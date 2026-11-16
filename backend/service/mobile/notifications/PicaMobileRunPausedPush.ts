import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import { detectPlanRunTransitions } from "@/backend/service/agents/AgentPlanRunTransitions";

import { wantsPlanInterruption } from "./NotificationChoicePolicy";

import type { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import type { AgentPlanRunObserver } from "@/backend/service/agents/AgentPlanRunObservers";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PicaMobileNotificationLocale } from "@/definition/PicaMobileNotifications";
import type { PicaMobileNotificationAccess } from "./PicaMobileNotificationAccess";
import type {
  PicaMobileAutomationPush,
  PicaMobilePushDevice,
} from "./PicaMobileAutomationPush";
import type { PicaMobilePushMessage } from "./PicaMobilePushSender";

/** The facts a pause push is built from. */
export interface PicaMobileRunPausedNotice {
  readonly runId: string;
  readonly planId: string;
  readonly planName: string;
  readonly accountId: string;
  /** ISO 8601 moment the pause was observed. */
  readonly occurredAt: string;
  /** ISO 8601 moment of the pause boundary; it names the notification. */
  readonly pausedAt: string;
}

/** What the pause push is created with. */
export interface PicaMobileRunPausedPushOptions {
  /** The relation to the run, the team choice and the rights on the run. */
  readonly runs: Pick<PicaMobileNotificationAccess, "read">;
  readonly preferences: Pick<
    PicaMobileNotificationPreferenceRepository,
    "find" | "listTeamRecipients"
  >;
  /** Hands the push to every activated device of a person. */
  readonly push: Pick<PicaMobileAutomationPush, "deliver">;
  readonly now?: () => Date;
}

interface PausedTexts {
  readonly title: string;
  readonly hiddenBody: string;
}

const COMPONENT = "PicaMobileRunPausedPush";
const MAXIMUM_NAME_LENGTH = 80;

const TEXTS: Readonly<Record<PicaMobileNotificationLocale, PausedTexts>> = {
  de: {
    title: "Plan pausiert",
    hiddenBody: "Zum Anzeigen der Details entsperren.",
  },
  en: {
    title: "Plan paused",
    hiddenBody: "Unlock to view details.",
  },
};

function clean(text: string): string {
  const collapsed = text
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(collapsed);
  return characters.length <= MAXIMUM_NAME_LENGTH
    ? collapsed
    : `${characters.slice(0, MAXIMUM_NAME_LENGTH - 1).join("")}…`;
}

/**
 * Builds the push of a paused run for one device.
 *
 * @param device - Token, language and preview choice of the device.
 * @param notice - The run, its plan and the moment of the pause.
 * @returns The push on the channel `pica-plan-results` with the type
 * `run_paused`. With `details` the body names the plan; with `hidden` it stays
 * generic, and no name enters the title or the data part.
 */
export function buildPicaMobileRunPausedPushMessage(
  device: PicaMobilePushDevice,
  notice: PicaMobileRunPausedNotice,
): PicaMobilePushMessage {
  const texts = TEXTS[device.registration.locale];
  const planName = clean(notice.planName);
  const hasDetails =
    device.registration.preview === "details" && planName !== "";
  const tag = `run:${notice.runId}:paused:${notice.pausedAt}`;

  return {
    token: device.token,
    title: texts.title,
    body: hasDetails ? planName : texts.hiddenBody,
    data: {
      pica_v: "1",
      pica_type: "run_paused",
      pica_instance: device.instanceId,
      pica_account: notice.accountId,
      pica_plan: notice.planId,
      pica_run: notice.runId,
      pica_at: notice.pausedAt,
      tag,
    },
    channelId: "pica-plan-results",
    tag,
    ttlSeconds: device.ttlSeconds,
  };
}

/**
 * Tells the people who may see a plan run that Pages paused it.
 *
 * @remarks
 * The pause is pushed directly, like an automation run: no event table, no
 * migration and no event read are involved. The recipients are chosen as for
 * the recorded events: the starter and the team members who switched team runs
 * on and have an activated device. For each of them Pages rechecks the rights
 * on the concrete run and the account choices; a device that registered
 * `hidden` gets no plan name. A failure is logged and never reaches the run.
 */
export class PicaMobileRunPausedPush implements AgentPlanRunObserver {
  private readonly options: PicaMobileRunPausedPushOptions;
  private readonly now: () => Date;

  /**
   * Creates the push; it announces pauses from {@link runChanged} on.
   *
   * @param options - Rights check, account choices and the device delivery.
   */
  public constructor(options: PicaMobileRunPausedPushOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Announces a run that just reached `paused`.
   *
   * @param previous - The view of the run before the write.
   * @param next - The view after the write.
   *
   * @remarks
   * `pausing`, a write that keeps `paused` and the resume announce nothing, so
   * only the committed write into `paused` sends. The work leaves the write in
   * the background and never waits for the push service.
   */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    if (
      !detectPlanRunTransitions(previous, next).some(
        (transition) => transition.kind === "run_paused",
      )
    ) {
      return;
    }

    void withBackgroundDatabaseWork("pica_mobile_run_paused_push", () =>
      this.notify(next),
    ).catch((error: unknown) => {
      logCaughtError(COMPONENT, error);
    });
  }

  /**
   * Hands the pause push to every account that may see the run.
   *
   * @param run - The paused view of the run.
   */
  public async notify(run: AgentPlanRun): Promise<void> {
    const occurredAt = this.now().toISOString();

    for (const accountId of await this.recipientIds(run)) {
      try {
        await this.deliverTo(run, accountId, occurredAt);
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);
      }
    }
  }

  private async recipientIds(run: AgentPlanRun): Promise<readonly string[]> {
    const accountIds = new Set([run.userId]);

    for (const preference of await this.options.preferences.listTeamRecipients()) {
      accountIds.add(preference.accountId);
    }

    return [...accountIds];
  }

  private async deliverTo(
    run: AgentPlanRun,
    accountId: string,
    occurredAt: string,
  ): Promise<void> {
    const access = await this.options.runs.read(accountId, run.id, occurredAt);

    if (access.status !== "granted") return;

    const choices = await this.options.preferences.find(accountId);

    if (!wantsPlanInterruption(choices)) return;

    const notice: PicaMobileRunPausedNotice = {
      runId: run.id,
      planId: run.planId,
      planName: access.plan.name,
      accountId,
      occurredAt,
      pausedAt: run.pauseBoundary?.pausedAt ?? occurredAt,
    };

    await this.options.push.deliver(
      accountId,
      (device) => buildPicaMobileRunPausedPushMessage(device, notice),
      {
        event: "pica_mobile.run_paused_push.handed_over",
        message: "Pica Mobile push of a paused plan run handed over",
        metadata: { runId: run.id },
      },
    );
  }
}
