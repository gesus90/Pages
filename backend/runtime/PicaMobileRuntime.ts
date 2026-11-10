import { getApplicationServices } from "@/app/lib/services.server";
import { logDiagnostic } from "@/backend/logging/Logger";
import { PagesPicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import { PagesPicaMobileDashboard } from "@/backend/service/mobile/PicaMobileDashboardService";
import { PicaMobileGateway } from "@/backend/service/mobile/PicaMobileGateway";
import { PicaMobileRelay } from "@/backend/service/mobile/PicaMobileRelay";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { PagesPicaMobileChat } from "@/backend/service/mobile/chat/PagesPicaMobileChat";
import { PagesPicaMobileConversations } from "@/backend/service/mobile/conversations/PagesPicaMobileConversations";
import { PagesPicaMobileNotifications } from "@/backend/service/mobile/notifications/PagesPicaMobileNotifications";
import { PagesPicaMobilePlans } from "@/backend/service/mobile/plans/PagesPicaMobilePlans";
import { PagesPicaMobileSpeech } from "@/backend/service/mobile/speech/PagesPicaMobileSpeech";
import { PicaMobilePlanRunObserver } from "@/backend/service/mobile/plans/PicaMobilePlanRunObserver";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";
import { PAGES_VERSION } from "@/definition/Version";

import { registerShutdownTask } from "./ProcessLifecycle";

import type { PagesConfig } from "@/backend/config/PagesConfig";
import type { PagesRuntime } from "./PagesRuntime";

declare global {
  var pagesPicaMobileGateway: PicaMobileGateway | undefined;
}

/** The relay side while `pages-core` holds the app's port (PAGE-239). */
function createRelay(config: PagesConfig): PicaMobileRelay | undefined {
  const { pagesCoreSecret, picaMobileRelayPort } = config;

  return pagesCoreSecret === undefined || picaMobileRelayPort === undefined
    ? undefined
    : new PicaMobileRelay({
        secret: pagesCoreSecret,
        port: picaMobileRelayPort,
      });
}

/**
 * Returns the Pica Mobile endpoint of the process, creating it on first use.
 *
 * @param runtime - Runtime of the process.
 * @param webPort - Port of the Pages web server, when it is known; the
 * endpoint refuses to take it.
 * @returns The one gateway of the process; it listens nowhere until it is told to.
 */
export function obtainPicaMobileGateway(
  runtime: PagesRuntime,
  webPort?: number,
): PicaMobileGateway {
  if (globalThis.pagesPicaMobileGateway === undefined) {
    const runs = new PicaMobilePlanRunObserver();
    const gateway = new PicaMobileGateway({
      authenticator: new PagesPicaMobileAuthenticator(
        async () => (await getApplicationServices()).authService,
      ),
      dashboard: new PagesPicaMobileDashboard(async () => {
        const services = await getApplicationServices();

        return {
          authService: services.authService,
          agentPlanActiveRunService: services.agentPlanActiveRunService,
          projectService: services.projectService,
          userService: services.userService,
        };
      }),
      notifications: new PagesPicaMobileNotifications(async () => {
        const services = await getApplicationServices();

        return {
          authService: services.authService,
          sessionService: services.sessionService,
          picaMobileNotifications: services.picaMobileNotifications,
        };
      }),
      plans: new PagesPicaMobilePlans({
        resolveServices: async () => {
          const services = await getApplicationServices();

          return {
            authService: services.authService,
            agentPlanOverviewService: services.agentPlanOverviewService,
          };
        },
        observer: runs,
      }),
      chat: new PagesPicaMobileChat(async () => {
        const services = await getApplicationServices();

        return {
          authService: services.authService,
          chatSessionService: services.chatSessionService,
          chatService: services.chatService,
          picaAcpService: services.picaAcpService,
          chatAttachmentService: services.chatAttachmentService,
          picaAdminService: services.picaAdminService,
        };
      }),
      conversations: new PagesPicaMobileConversations({
        resolveServices: async () => {
          const services = await getApplicationServices();

          return {
            authService: services.authService,
            conversationReader: services.conversationReader,
            conversationService: services.conversationService,
          };
        },
        events: sharedConversationEvents(),
      }),
      speech: new PagesPicaMobileSpeech(async () => {
        const services = await getApplicationServices();

        return {
          authService: services.authService,
          speechRecognitionService: services.speechRecognitionService,
        };
      }),
      serverVersion: PAGES_VERSION,
      listenAddress: runtime.getConfig().listenAddress,
      relay: createRelay(runtime.getConfig()),
      reservedPort: webPort,
    });

    const stopObserving = sharedAgentPlanRunObservers().add(runs);

    globalThis.pagesPicaMobileGateway = gateway;
    registerShutdownTask(
      async () => {
        stopObserving();
        await gateway.close();
      },
      {
        step: "pica_mobile_gateway",
      },
    );
  }

  return globalThis.pagesPicaMobileGateway;
}

/**
 * Starts the Pica Mobile endpoint on the stored port, when there is one.
 *
 * @param runtime - Runtime of the process.
 * @param webPort - Port the Pages web server listens on.
 *
 * @remarks
 * A port that cannot be bound is logged and reported to the operator; the web
 * server keeps running, and an administrator can store another port. While
 * `pages-core` holds the app's port, the endpoint listens on the loopback
 * relay port instead (PAGE-239).
 */
export async function startPicaMobile(
  runtime: PagesRuntime,
  webPort: number,
): Promise<void> {
  const gateway = obtainPicaMobileGateway(runtime, webPort);
  const port = gateway.relay?.port ?? runtime.getConfig().picaMobilePort;

  if (port === undefined) {
    return;
  }

  try {
    await gateway.switchTo(port, () => Promise.resolve());
  } catch (error: unknown) {
    logDiagnostic(
      "PicaMobileRuntime",
      "warn",
      `[pages] Pica Mobile cannot listen on port ${port}. Store another port in Settings > Connections.`,
      error,
    );
  }
}
