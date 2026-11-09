import { canProcessIntegrations } from "@/backend/service/integrations/IntegrationProcessing";
import { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import {
  createNotificationEventId,
  PicaMobileNotificationEventRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { logEvent } from "@/backend/logging/Logger";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { sharedPicaMobileConversationPresence } from "@/backend/service/mobile/conversations/PicaMobileConversationPresence";
import { PicaMobileConversationPush } from "@/backend/service/mobile/notifications/PicaMobileConversationPush";
import { createPicaMobilePushSender } from "@/backend/service/mobile/notifications/PicaMobilePushSenders";
import { PagesPicaMobileAccountChecks } from "@/backend/service/mobile/notifications/PicaMobileAccountChecks";
import { PicaMobileNotificationAccess } from "@/backend/service/mobile/notifications/PicaMobileNotificationAccess";
import { PicaMobileNotificationDispatcher } from "@/backend/service/mobile/notifications/PicaMobileNotificationDispatcher";
import { PicaMobileNotificationEventReader } from "@/backend/service/mobile/notifications/PicaMobileNotificationEventReader";
import { PicaMobileNotificationRecorder } from "@/backend/service/mobile/notifications/PicaMobileNotificationRecorder";
import { PicaMobileNotificationService } from "@/backend/service/mobile/notifications/PicaMobileNotificationService";
import { readPicaMobileNotificationSettings } from "@/backend/service/mobile/notifications/PicaMobileNotificationSettings";
import { PicaMobilePushRegistrations } from "@/backend/service/mobile/notifications/PicaMobilePushRegistrations";
import { PicaMobilePushTokenVault } from "@/backend/service/mobile/notifications/PicaMobilePushTokenVault";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { UserService } from "@/backend/service/UserService";

declare global {
  var pagesPicaMobileNotifications: PicaMobileNotificationService | undefined;
  var pagesPicaMobileConversationPush: (() => void) | undefined;
}

/** What the notification services are built on. */
export interface PicaMobileNotificationInput {
  readonly database: Database;
  readonly users: UserService;
  /** Proves the relation to a run, starter or team member, and the rights on it. */
  readonly ownerRuns: AgentPlanOwnerRunReader;
}

/**
 * Sends the pushes of new conversation messages (PAGE-278) from now on; a
 * second call replaces the first.
 */
function followConversationMessages(input: {
  readonly database: Database;
  readonly registrations: PicaMobilePushRegistrationRepository;
  readonly accounts: PagesPicaMobileAccountChecks;
  readonly vault: PicaMobilePushTokenVault;
  readonly sender: ReturnType<typeof createPicaMobilePushSender>;
  readonly instanceId: () => Promise<string>;
  readonly ttlSeconds: number;
}): void {
  globalThis.pagesPicaMobileConversationPush?.();
  const conversations = new ConversationRepository(input.database);
  const push = new PicaMobileConversationPush({
    registrations: input.registrations,
    accounts: input.accounts,
    vault: input.vault,
    sender: input.sender,
    instanceId: input.instanceId,
    mutedMemberIds: (conversationId) =>
      conversations.mutedMemberIds(conversationId),
    conversation: (conversationId, memberId) =>
      conversations.findForMember(conversationId, memberId),
    presence: sharedPicaMobileConversationPresence(),
    ttlSeconds: input.ttlSeconds,
  });
  const stop = push.follow(sharedConversationEvents());
  globalThis.pagesPicaMobileConversationPush = stop;
  registerShutdownTask(
    () => {
      stop();
      return Promise.resolve();
    },
    { step: "pica_mobile_conversation_push" },
  );
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
  const sender = createPicaMobilePushSender(settings.fcmServiceAccountFile);
  const registrationRepository = new PicaMobilePushRegistrationRepository(
    input.database,
  );
  const eventRepository = new PicaMobileNotificationEventRepository(
    input.database,
  );
  const preferences = new PicaMobileNotificationPreferenceRepository(
    input.database,
  );
  const runAccess = new PicaMobileNotificationAccess(
    input.ownerRuns,
    preferences,
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
  const accounts = new PagesPicaMobileAccountChecks(
    new SessionRepository(input.database),
    input.users,
  );
  followConversationMessages({
    database: input.database,
    registrations: registrationRepository,
    accounts,
    vault,
    sender,
    instanceId: readInstanceId,
    ttlSeconds: settings.replayTtlSeconds,
  });
  const dispatcher = new PicaMobileNotificationDispatcher({
    canDispatch: canProcessIntegrations,
    deliveries: new PicaMobileNotificationDeliveryRepository(input.database),
    events: eventRepository,
    registrations: registrationRepository,
    runs: runAccess,
    accounts,
    vault,
    sender,
    instanceId: readInstanceId,
  });
  const recorder = new PicaMobileNotificationRecorder({
    registrations: registrationRepository,
    events: eventRepository,
    preferences,
    runs: runAccess,
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
    events: new PicaMobileNotificationEventReader(eventRepository, runAccess),
    recorder,
    dispatcher,
    preferences,
    isPushAvailable: sender !== null,
    detach: sharedAgentPlanRunObservers().add(recorder),
  });

  if (!isLocalSessionOwner() && canProcessIntegrations()) service.start();
  globalThis.pagesPicaMobileNotifications = service;
  registerShutdownTask(() => service.stop(), {
    step: "pica_mobile_notifications",
  });
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
