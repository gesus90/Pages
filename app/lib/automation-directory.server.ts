import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { isAutomationTimeZone } from "@/definition/AutomationSchema";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type {
  AutomationAccount,
  AutomationDirectory,
  AutomationPlanReference,
} from "@/backend/service/automation/AutomationDirectory";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { AgentPlanNode } from "@/definition/AgentPlan";
import type {
  AutomationAgentChoice,
  AutomationChoice,
  AutomationProjectChoice,
} from "@/definition/Automation";

/** Node kinds that are no step of a run. */
const NO_STEP: ReadonlySet<string> = new Set([
  "start",
  "end",
  "parameter",
  "variable",
  "asset",
]);

/** The services the facts of automations are read from. */
export interface AutomationDirectoryInput {
  readonly database: Database;
  readonly plans: AgentPlanService;
  readonly projects: ProjectService;
  readonly tasks: TaskService;
  readonly workspaces: AgentWorkspaceService;
}

function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function stepLabel(node: AgentPlanNode): string {
  if ("name" in node && typeof node.name === "string" && node.name !== "")
    return node.name;
  if (node.type === "agent" && node.configuration?.name)
    return node.configuration.name;
  return node.type;
}

/**
 * Reads the facts of Pages that the rules of automations decide on (PAGE-297).
 *
 * @remarks
 * Every answer comes from the services of the pages themselves, read anew
 * for each call: plan access from the plan service, project access from the
 * project service, memberships from their tables and administrator mode from
 * the account's current authorization.
 */
export class PagesAutomationDirectory implements AutomationDirectory {
  private readonly input: AutomationDirectoryInput;
  private readonly users: UserRepository;
  private readonly authorization: AuthorizationRepository;
  private readonly employees: EmployeeStore;
  private readonly projectRepository: ProjectRepository;
  private readonly groupRepository: UserGroupRepository;
  private readonly settings: UserSettingsRepository;
  private readonly policy = new UserPolicyService();

  public constructor(input: AutomationDirectoryInput) {
    this.input = input;
    this.users = new UserRepository(input.database);
    this.authorization = new AuthorizationRepository(input.database);
    this.employees = new EmployeeStore(input.database);
    this.projectRepository = new ProjectRepository(input.database);
    this.groupRepository = new UserGroupRepository(input.database);
    this.settings = new UserSettingsRepository(input.database);
  }

  /** The account with its administrator mode, access and time zone. */
  public async account(userId: string): Promise<AutomationAccount | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    const [snapshot, settings, employee] = await Promise.all([
      this.authorization.snapshot(),
      this.settings.findByUserId(user.id),
      user.isAgent === true ? this.employees.employees().find(user.id) : null,
    ]);
    const access = snapshot.accounts.find((entry) => entry.userId === user.id);
    return {
      id: user.id,
      displayName: user.displayName,
      isAgent: user.isAgent === true,
      isActive: user.isActive && (access?.isActive ?? true),
      isAdministrator: access ? this.policy.isAdministrator(access) : false,
      isReadOnly: employee?.access === "read_only",
      timeZone:
        settings?.timezone && isAutomationTimeZone(settings.timezone)
          ? settings.timezone
          : serverTimeZone(),
      language: settings?.language === "en" ? "en" : "de",
    };
  }

  /** The active agent employees with their positions. */
  public async agents(): Promise<readonly AutomationAgentChoice[]> {
    const [users, employees, titles] = await Promise.all([
      this.users.findAll(),
      this.employees.employees().list(),
      this.employees.identities().jobTitles(),
    ]);
    const employed = new Set(employees.map((employee) => employee.userId));
    return users
      .filter(
        (user) =>
          user.isAgent === true && user.isActive && employed.has(user.id),
      )
      .map((user) => ({
        id: user.id,
        name: user.displayName,
        position: titles.get(user.id) ?? null,
      }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }

  /** The plans the account can see; it may start those it changes. */
  public async plans(
    userId: string,
  ): Promise<readonly AutomationPlanReference[]> {
    const summaries = await this.input.plans.summaries(userId);
    return summaries.map((plan) => ({
      id: plan.id,
      name: plan.name,
      projectName: plan.projectName ?? null,
      canStart: plan.canEdit && plan.isWorkspaceMissing !== true,
    }));
  }

  /** The steps of a visible plan. */
  public async planSteps(
    userId: string,
    planId: string,
  ): Promise<readonly AutomationChoice[] | null> {
    try {
      const plan = await this.input.plans.view(userId, planId);
      return plan.nodes
        .filter((node) => !NO_STEP.has(node.type))
        .map((node) => ({ id: node.id, name: stepLabel(node) }));
    } catch {
      return null;
    }
  }

  /** The projects the account can open, with their statuses. */
  public async projects(
    userId: string,
  ): Promise<readonly AutomationProjectChoice[]> {
    const user = await this.users.findById(userId);
    if (!user?.isActive) return [];
    const [projects, statuses] = await Promise.all([
      this.input.projects.findAll(user),
      this.input.tasks.findAllStatuses(user),
    ]);
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      statuses: statuses
        .filter(
          (status) =>
            status.projectId === null || status.projectId === project.id,
        )
        .map((status) => ({ id: status.id, name: status.name })),
    }));
  }

  /** The projects the account is a member of. */
  public async memberProjects(
    userId: string,
  ): Promise<readonly AutomationChoice[]> {
    const projects = await this.projectRepository.findByMemberId(userId);
    return projects.map((project) => ({ id: project.id, name: project.name }));
  }

  /** The user groups the account is a member of. */
  public async groups(userId: string): Promise<readonly AutomationChoice[]> {
    const groups = await this.groupRepository.findAll();
    return groups
      .filter((group) => group.memberIds.includes(userId))
      .map((group) => ({ id: group.id, name: group.name }));
  }

  /** Whether the account is a member of the project. */
  public async isProjectMember(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    return this.projectRepository.isMember(projectId, userId);
  }

  /** Whether the account manages the project. */
  public async isProjectManager(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    return this.projectRepository.isProjectManager(projectId, userId);
  }

  /** Whether the account is a member of the group. */
  public async isGroupMember(
    groupId: string,
    userId: string,
  ): Promise<boolean> {
    return (await this.groupRepository.findIdsByMember(userId)).includes(
      groupId,
    );
  }

  /** The usable local workspaces of the account. */
  public async workspaces(
    userId: string,
  ): Promise<readonly AutomationChoice[]> {
    const choices = await this.input.workspaces.choices(userId);
    return choices
      .filter((choice) => choice.isUsable && choice.kind !== "remote")
      .map((choice) => ({ id: choice.id, name: choice.name }));
  }

  /** The configured interpreter profiles, without their paths. */
  public async interpreterProfiles(): Promise<readonly AutomationChoice[]> {
    const snapshot = await (
      await getPagesRuntime()
    ).interpreterProfiles.snapshot();
    return snapshot.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    }));
  }

  /** The names of every project and group, for shared automations. */
  public async sharingNames(): Promise<ReadonlyMap<string, string>> {
    const [projects, groups] = await Promise.all([
      this.projectRepository.findActiveIds(),
      this.groupRepository.findAll(),
    ]);
    const names = new Map<string, string>();
    for (const id of projects) {
      const project = await this.projectRepository.findById(id);
      if (project) names.set(project.id, project.name);
    }
    for (const group of groups) names.set(group.id, group.name);
    return names;
  }
}
