import { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import {
  createNotificationEventId,
  PicaMobileNotificationEventRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { logEvent } from "@/backend/logging/Logger";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";
import { createFcmPicaMobilePushSender } from "@/backend/service/mobile/notifications/FcmPicaMobilePushSender";
import { PagesPicaMobileAccountChecks } from "@/backend/service/mobile/notifications/PicaMobileAccountChecks";
import { PicaMobileNotificationDispatcher } from "@/backend/service/mobile/notifications/PicaMobileNotificationDispatcher";
import { PicaMobileNotificationEventReader } from "@/backend/service/mobile/notifications/PicaMobileNotificationEventReader";
import { PicaMobileNotificationRecorder } from "@/backend/service/mobile/notifications/PicaMobileNotificationRecorder";
import { PicaMobileNotificationService } from "@/backend/service/mobile/notifications/PicaMobileNotificationService";
import { readPicaMobileNotificationSettings } from "@/backend/service/mobile/notifications/PicaMobileNotificationSettings";
import { PicaMobilePushRegistrations } from "@/backend/service/mobile/notifications/PicaMobilePushRegistrations";
import { PicaMobilePushTokenVault } from "@/backend/service/mobile/notifications/PicaMobilePushTokenVault";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { UserService } from "@/backend/service/UserService";

declare global {
  var pagesPicaMobileNotifications: PicaMobileNotificationService | undefined;
}

/** What the notification services are built on. */
export interface PicaMobileNotificationInput {
  readonly database: Database;
  readonly users: UserService;
  /** Proves plan ownership and the rights on a concrete run. */
  readonly ownerRuns: AgentPlanOwnerRunReader;
}

/**
 * Builds the notification backend of Pica Mobile and starts its dispatcher.
 *
 * @param input - The database, the accounts and the rights check on runs.
 * @returns The service. It listens to run transitions from now on; nothing it
 * does can change, delay or block a run.
 *
 * @remarks
 * The FCM sender exists only when the operator named a readable key file; a
 * missing or invalid file leaves the service without push, which it reports
 * honestly to the app. Pushes recorded before a restart are sent after it as
 * long as their validity has not elapsed. The service stops before the
 * database closes.
 */
export async function createPicaMobileNotificationServices(
  input: PicaMobileNotificationInput,
): Promise<{
  readonly picaMobileNotifications: PicaMobileNotificationService;
}> {
  await globalThis.pagesPicaMobileNotifications?.stop();

  const runtime = await getPagesRuntime();
  const settings = readPicaMobileNotificationSettings(runtime.getConfig());
  const sender =
    settings.fcmServiceAccountFile === null
      ? null
      : createFcmPicaMobilePushSender(settings.fcmServiceAccountFile);
  const registrationRepository = new PicaMobilePushRegistrationRepository(
    input.database,
  );
  const eventRepository = new PicaMobileNotificationEventRepository(
    input.database,
  );
  const vault = new PicaMobilePushTokenVault(
    resolveGitHubTokenKey(runtime.getDatabasePath()),
  );
  let instanceId: Promise<string> | null = null;
  const readInstanceId = (): Promise<string> => {
    // A failed read is not remembered, so the next request tries again.
    instanceId ??= eventRepository
      .readInstanceId(createNotificationEventId())
      .catch((error: unknown) => {
        instanceId = null;

        throw error;
      });

    return instanceId;
  };
  const dispatcher = new PicaMobileNotificationDispatcher({
    deliveries: new PicaMobileNotificationDeliveryRepository(input.database),
    events: eventRepository,
    registrations: registrationRepository,
    runs: input.ownerRuns,
    accounts: new PagesPicaMobileAccountChecks(
      new SessionRepository(input.database),
      input.users,
    ),
    vault,
    sender,
    instanceId: readInstanceId,
  });
  const recorder = new PicaMobileNotificationRecorder({
    registrations: registrationRepository,
    events: eventRepository,
    runs: input.ownerRuns,
    replayTtlSeconds: settings.replayTtlSeconds,
    onRecorded: () => dispatcher.kick(),
  });
  const service = new PicaMobileNotificationService({
    registrations: new PicaMobilePushRegistrations({
      repository: registrationRepository,
      vault,
      instanceId: readInstanceId,
      replayTtlSeconds: settings.replayTtlSeconds,
    }),
    events: new PicaMobileNotificationEventReader(
      eventRepository,
      input.ownerRuns,
    ),
    recorder,
    dispatcher,
    isPushAvailable: sender !== null,
    detach: sharedAgentPlanRunObservers().add(recorder),
  });

  service.start();
  globalThis.pagesPicaMobileNotifications = service;
  registerShutdownTask(() => service.stop());
  logEvent({
    level: "info",
    event: "pica_mobile.notifications.started",
    component: "PicaMobileNotificationServices",
    message: "Pica Mobile notifications started",
    metadata: {
      status: sender === null ? "push_unavailable" : "push_available",
    },
  });

  return { picaMobileNotifications: service };
}
