import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import {
  createNotificationEventId,
  PicaMobileNotificationEventRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import { createFcmPicaMobilePushSender } from "@/backend/service/mobile/notifications/FcmPicaMobilePushSender";
import { PagesPicaMobileAccountChecks } from "@/backend/service/mobile/notifications/PicaMobileAccountChecks";
import { PicaMobileNotificationAccess } from "@/backend/service/mobile/notifications/PicaMobileNotificationAccess";
import { PicaMobileNotificationDispatcher } from "@/backend/service/mobile/notifications/PicaMobileNotificationDispatcher";
import { readPicaMobileNotificationSettings } from "@/backend/service/mobile/notifications/PicaMobileNotificationSettings";
import { PicaMobilePushTokenVault } from "@/backend/service/mobile/notifications/PicaMobilePushTokenVault";

import { canProcessIntegrations } from "./IntegrationProcessing";

import type { PagesConfig } from "@/backend/config/PagesConfig";
import type { Database } from "@/backend/database/Database";
import type { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import type { UserService } from "@/backend/service/UserService";

/** Constructs only the durable push consumer; registration and run recording stay in the server. */
export function createIntegrationFcmConsumer(input: {
  readonly database: Database;
  readonly config: PagesConfig;
  readonly tokenKey: Buffer;
  readonly users: UserService;
  readonly runs: AgentPlanOwnerRunReader;
}): PicaMobileNotificationDispatcher {
  const { database } = input;
  const events = new PicaMobileNotificationEventRepository(database);
  const settings = readPicaMobileNotificationSettings(input.config);
  return new PicaMobileNotificationDispatcher({
    canDispatch: canProcessIntegrations,
    deliveries: new PicaMobileNotificationDeliveryRepository(database),
    events,
    registrations: new PicaMobilePushRegistrationRepository(database),
    runs: new PicaMobileNotificationAccess(
      input.runs,
      new PicaMobileNotificationPreferenceRepository(database),
    ),
    accounts: new PagesPicaMobileAccountChecks(
      new SessionRepository(database),
      input.users,
    ),
    vault: new PicaMobilePushTokenVault(input.tokenKey),
    sender:
      settings.fcmServiceAccountFile === null
        ? null
        : createFcmPicaMobilePushSender(settings.fcmServiceAccountFile),
    instanceId: () => events.readInstanceId(createNotificationEventId()),
  });
}
