import { AutomationError } from "@/backend/error/AutomationError";

import type {
  AutomationAction,
  AutomationAgentNotification,
  AutomationPermissions,
  AutomationSharing,
  AutomationTrigger,
} from "@/definition/Automation";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationErrorReason } from "@/backend/error/AutomationError";
import type {
  AutomationAccount,
  AutomationDirectory,
} from "./AutomationDirectory";

/** The parts of an automation that rights are checked for. */
export interface AutomationDefinition {
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly sharing: AutomationSharing;
  readonly agentNotification: AutomationAgentNotification;
  readonly deleteAfterSuccess: boolean;
}

/** Which parts a save changes; unchanged parts keep their earlier check. */
export interface AutomationChangedParts {
  readonly trigger: boolean;
  readonly action: boolean;
  readonly sharing: boolean;
  readonly agentNotification: boolean;
}

const NOTHING_VISIBLE: AutomationPermissions = {
  canRead: false,
  canEdit: false,
  canRun: false,
  canDelete: false,
};

function refuse(
  code: "invalid_request" | "forbidden",
  reason: AutomationErrorReason,
): never {
  throw new AutomationError(code, { reason });
}

/**
 * The rules of automations (PAGE-297).
 *
 * @remarks
 * A share lets project or group members see an automation; the creator,
 * the managers of a shared project and administrators change, run and
 * delete it. A run always uses exactly the rights of its creator: an action
 * is allowed when the creator may chat with the agent, start the plan or,
 * as an active administrator, run scripts. Changing an action also needs
 * those rights from the account that changes it, so nobody gains a right
 * through someone else's automation.
 */
export class AutomationAccess {
  private readonly directory: AutomationDirectory;

  public constructor(directory: AutomationDirectory) {
    this.directory = directory;
  }

  /**
   * Resolves the calling account.
   *
   * @throws {AutomationError} `forbidden` for a missing or inactive account.
   */
  public async actor(userId: string): Promise<AutomationAccount> {
    const account = await this.directory.account(userId);
    if (!account?.isActive) throw new AutomationError("forbidden");
    return account;
  }

  /** Reads an account that may be inactive; `null` when it no longer exists. */
  public async account(userId: string): Promise<AutomationAccount | null> {
    return this.directory.account(userId);
  }

  /** What an account may do with an automation. */
  public async permissions(
    automation: StoredAutomation,
    viewer: AutomationAccount,
  ): Promise<AutomationPermissions> {
    const isCreator = automation.creatorId === viewer.id;
    const { sharing } = automation;
    const canRead =
      viewer.isAdministrator ||
      isCreator ||
      (sharing.scope === "project" &&
        (await this.directory.isProjectMember(sharing.projectId, viewer.id))) ||
      (sharing.scope === "group" &&
        (await this.directory.isGroupMember(sharing.groupId, viewer.id)));
    if (!canRead) return NOTHING_VISIBLE;
    const canManage =
      viewer.isActive &&
      !viewer.isReadOnly &&
      (isCreator ||
        viewer.isAdministrator ||
        (sharing.scope === "project" &&
          (await this.directory.isProjectManager(
            sharing.projectId,
            viewer.id,
          ))));
    return {
      canRead: true,
      canEdit: canManage,
      canRun: canManage,
      canDelete: canManage,
    };
  }

  /** Whether an account sees a script's content: a manager that is its creator or an administrator. */
  public canSeeScript(
    automation: StoredAutomation,
    viewer: AutomationAccount,
    permissions: AutomationPermissions,
  ): boolean {
    return (
      permissions.canEdit &&
      (viewer.isAdministrator || automation.creatorId === viewer.id)
    );
  }

  /**
   * Checks a definition before it is saved.
   *
   * @param definition - The complete definition after the save.
   * @param parties - The creator, whose rights the runs use, and the account that saves.
   * @param changed - The parts the save changes.
   * @throws {AutomationError} `invalid_request` or `forbidden` with its reason.
   */
  public async checkDefinition(
    definition: AutomationDefinition,
    parties: {
      readonly creator: AutomationAccount;
      readonly editor: AutomationAccount;
    },
    changed: AutomationChangedParts,
  ): Promise<void> {
    if (definition.deleteAfterSuccess && definition.trigger.type !== "once")
      refuse("invalid_request", "delete_after_success_invalid");
    const accounts =
      parties.creator.id === parties.editor.id
        ? [parties.creator]
        : [parties.creator, parties.editor];
    if (changed.action)
      for (const account of accounts)
        await this.checkAction(definition.action, account);
    if (changed.trigger)
      await this.checkTrigger(definition.trigger, parties.creator);
    if (changed.sharing)
      await this.checkSharing(definition.sharing, parties.creator);
    const notification = definition.agentNotification;
    if (changed.agentNotification && notification.mode !== "off")
      for (const account of accounts)
        await this.requireAgent(notification.agentId ?? "", account);
  }

  /**
   * Checks the creator's rights before a run.
   *
   * @returns `null` when the run may start, otherwise why not.
   */
  public async runBlocker(
    automation: StoredAutomation,
  ): Promise<AutomationErrorReason | "creator_inactive" | null> {
    const creator = await this.directory.account(automation.creatorId);
    if (!creator?.isActive) return "creator_inactive";
    try {
      await this.checkAction(automation.action, creator, {
        hasStoredContent: true,
      });
      return null;
    } catch (error: unknown) {
      if (error instanceof AutomationError && error.reason) return error.reason;
      throw error;
    }
  }

  /**
   * Whether an account may still wake an agent: it is active and an agent employee.
   *
   * @param agentId - The agent to wake.
   * @param account - The account whose rights count.
   */
  public async canUseAgent(
    agentId: string,
    account: AutomationAccount,
  ): Promise<boolean> {
    if (!account.isActive) return false;
    const agents = await this.directory.agents();
    return agents.some((agent) => agent.id === agentId);
  }

  /** Whether a creator can see a plan, for plan events. */
  public async canSeePlan(planId: string, userId: string): Promise<boolean> {
    const plans = await this.directory.plans(userId);
    return plans.some((plan) => plan.id === planId);
  }

  /** Whether a creator can open a project, for ticket events. */
  public async canSeeProject(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const projects = await this.directory.projects(userId);
    return projects.some((project) => project.id === projectId);
  }

  private async checkAction(
    action: AutomationAction,
    account: AutomationAccount,
    options: { readonly hasStoredContent?: boolean } = {},
  ): Promise<void> {
    if (action.type === "agent") {
      await this.requireAgent(action.agentId, account);
      return;
    }
    if (action.type === "plan") {
      const plans = await this.directory.plans(account.id);
      if (!plans.some((plan) => plan.id === action.planId && plan.canStart))
        refuse("forbidden", "plan_unavailable");
      return;
    }
    if (!account.isAdministrator) refuse("forbidden", "script_forbidden");
    if (action.content === null && !options.hasStoredContent)
      refuse("invalid_request", "validation");
    const workspaces = await this.directory.workspaces(account.id);
    if (!workspaces.some((workspace) => workspace.id === action.workspaceId))
      refuse("forbidden", "workspace_unavailable");
    const profiles = await this.directory.interpreterProfiles();
    if (!profiles.some((profile) => profile.id === action.interpreterProfileId))
      refuse("invalid_request", "interpreter_unavailable");
    if (action.forward)
      await this.requireAgent(action.forward.agentId, account);
  }

  private async requireAgent(
    agentId: string,
    account: AutomationAccount,
  ): Promise<void> {
    if (!(await this.canUseAgent(agentId, account)))
      refuse("forbidden", "agent_unavailable");
  }

  private async checkTrigger(
    trigger: AutomationTrigger,
    creator: AutomationAccount,
  ): Promise<void> {
    if (trigger.type !== "event") return;
    if (trigger.planId) {
      const steps = await this.directory.planSteps(creator.id, trigger.planId);
      if (steps === null) refuse("invalid_request", "event_filter_invalid");
      if (trigger.stepId && !steps.some((step) => step.id === trigger.stepId))
        refuse("invalid_request", "event_filter_invalid");
    }
    if (trigger.projectId) {
      const projects = await this.directory.projects(creator.id);
      const project = projects.find((entry) => entry.id === trigger.projectId);
      if (!project) refuse("invalid_request", "event_filter_invalid");
      if (
        trigger.statusId &&
        !project.statuses.some((status) => status.id === trigger.statusId)
      )
        refuse("invalid_request", "event_filter_invalid");
    }
  }

  private async checkSharing(
    sharing: AutomationSharing,
    creator: AutomationAccount,
  ): Promise<void> {
    if (sharing.scope === "project") {
      if (
        !(await this.directory.isProjectMember(sharing.projectId, creator.id))
      )
        refuse("invalid_request", "sharing_target_invalid");
      return;
    }
    if (
      sharing.scope === "group" &&
      !(await this.directory.isGroupMember(sharing.groupId, creator.id))
    )
      refuse("invalid_request", "sharing_target_invalid");
  }
}
