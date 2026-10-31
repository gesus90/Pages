import { logCaughtError } from "@/backend/logging/Logger";
import { AgentError } from "@/backend/error/AgentErrors";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";

import { PicaMobileAvatars } from "./PicaMobileAvatars";
import { toDashboardRun } from "./PicaMobileRunMapping";

import type { AuthService } from "@/backend/auth/AuthService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { AgentPlanActiveRunService } from "@/backend/service/agents/AgentPlanActiveRuns";
import type { AssignedProject } from "@/definition/Project";
import type {
  PicaMobileAvatarReference,
  PicaMobileDashboardProject,
  PicaMobileDashboardSection,
} from "@/definition/PicaMobileProtocol";
import type { User } from "@/definition/User";
import type {
  PicaMobileAvatarOutcome,
  PicaMobileDashboardOutcome,
  PicaMobileDashboardProvider,
  PicaMobileSessionIdentity,
} from "./PicaMobileDashboardProvider";
import type { PicaMobileAvatarSource } from "./PicaMobileAvatars";

/** The Pages services the dashboard reads from. */
export interface PicaMobileDashboardServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly agentPlanActiveRunService: Pick<AgentPlanActiveRunService, "list">;
  readonly projectService: Pick<ProjectService, "findAssigned">;
  readonly userService: PicaMobileAvatarSource;
}

const COMPONENT = "PicaMobileDashboardService";

function isAccessRefusal(error: unknown): boolean {
  return (
    error instanceof ProjectAccessDeniedError ||
    (error instanceof AgentError && error.code === "plan_access_denied")
  );
}

/** Turns one read into a section: its items, a refusal, or an honest failure. */
async function readSection<Item>(
  read: () => Promise<readonly Item[]>,
): Promise<PicaMobileDashboardSection<Item>> {
  try {
    return { status: "ready", items: await read() };
  } catch (error: unknown) {
    if (isAccessRefusal(error)) {
      return { status: "forbidden" };
    }

    logCaughtError(COMPONENT, error);

    return { status: "error" };
  }
}

function toDashboardProject(entry: AssignedProject): PicaMobileDashboardProject {
  return {
    id: entry.project.id,
    name: entry.project.name,
    icon: null,
    assigned: true,
    // The stored percentage is a manual value; it travels with the goal
    // counts, which exist only for a project that has goals.
    progress:
      entry.goalCount === 0
        ? null
        : {
            percent: entry.project.progress,
            completed: entry.completedGoalCount,
            total: entry.goalCount,
          },
  };
}

/**
 * Answers the dashboard messages of Pica Mobile from the live Pages data.
 *
 * @remarks
 * Every answer starts from the account the session belongs to right now and
 * reads runs, projects and the avatar through the services that apply the
 * account's current rights. A section that cannot be read is `error` and one
 * the account may not read `forbidden`; neither stops the other sections, and
 * an avatar that is missing or unusable only leaves `avatar` empty.
 */
export class PagesPicaMobileDashboard implements PicaMobileDashboardProvider {
  private readonly resolveServices: () => Promise<PicaMobileDashboardServices>;
  private readonly avatars = new PicaMobileAvatars();

  /**
   * Creates the provider.
   *
   * @param resolveServices - Resolves the Pages services when a request needs
   * them, so the listener works before the database does.
   */
  public constructor(
    resolveServices: () => Promise<PicaMobileDashboardServices>,
  ) {
    this.resolveServices = resolveServices;
  }

  /** Reads profile, own active runs and assigned projects of the account. */
  public async readDashboard(
    session: PicaMobileSessionIdentity,
  ): Promise<PicaMobileDashboardOutcome> {
    const services = await this.resolveServices();
    const user = await this.currentUser(services, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    const [avatar, runs, projects] = await Promise.all([
      this.readAvatarReference(services, user),
      readSection(async () =>
        (await services.agentPlanActiveRunService.list(user.id)).map(
          toDashboardRun,
        ),
      ),
      readSection(async () =>
        (await services.projectService.findAssigned(user)).map(
          toDashboardProject,
        ),
      ),
    ]);

    return {
      kind: "ready",
      dashboard: {
        profile: {
          accountId: user.id,
          displayName: user.displayName,
          avatar,
        },
        runs,
        projects,
      },
    };
  }

  /** Reads the current avatar of the account when it still has the given version. */
  public async readAvatar(
    session: PicaMobileSessionIdentity,
    version: string,
  ): Promise<PicaMobileAvatarOutcome> {
    const services = await this.resolveServices();
    const user = await this.currentUser(services, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    const avatar = await this.avatars.current(services.userService, user);

    if (avatar === null || avatar.version !== version) {
      return { kind: "notFound" };
    }

    return {
      kind: "ready",
      avatar: {
        version: avatar.version,
        mimeType: avatar.mimeType,
        data: avatar.data.toString("base64"),
      },
    };
  }

  /** The account of the session as it is now; `null` when the session or the account no longer holds. */
  private async currentUser(
    services: PicaMobileDashboardServices,
    session: PicaMobileSessionIdentity,
  ): Promise<User | null> {
    const user = await services.authService.getAuthenticatedUser(
      session.sessionToken,
    );

    if (
      user === null ||
      user.id !== session.userId ||
      !user.isActive ||
      user.mustChangePassword
    ) {
      return null;
    }

    return user;
  }

  private async readAvatarReference(
    services: PicaMobileDashboardServices,
    user: User,
  ): Promise<PicaMobileAvatarReference | null> {
    try {
      const avatar = await this.avatars.current(services.userService, user);

      return avatar === null
        ? null
        : { version: avatar.version, mimeType: avatar.mimeType };
    } catch (error: unknown) {
      // The avatar is decoration; the rest of the dashboard must not depend on it.
      logCaughtError(COMPONENT, error);

      return null;
    }
  }
}
