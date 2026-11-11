import type {
  AutomationAgentChoice,
  AutomationChoice,
  AutomationProjectChoice,
} from "@/definition/Automation";

/** An account as automations see it: the creator, a reader or an editor. */
export interface AutomationAccount {
  readonly id: string;
  readonly displayName: string;
  readonly isAgent: boolean;
  readonly isActive: boolean;
  /** Active, administrator and in administrator mode; never an agent. */
  readonly isAdministrator: boolean;
  /** An agent whose access is "read only" may list and read, nothing else. */
  readonly isReadOnly: boolean;
  /** The account's time zone; times of its automations count in it. */
  readonly timeZone: string;
  readonly language: "de" | "en";
}

/** A plan the account can see. */
export interface AutomationPlanReference extends AutomationChoice {
  readonly projectName: string | null;
  /** Whether the account may start a run of it. */
  readonly canStart: boolean;
}

/**
 * The facts of Pages that the rules of automations are decided on (PAGE-297).
 *
 * @remarks
 * Every answer is read anew for each call: rights that were taken away count
 * at once, also for a run that was planned before.
 */
export interface AutomationDirectory {
  account(userId: string): Promise<AutomationAccount | null>;
  /** The active agents with their positions. */
  agents(): Promise<readonly AutomationAgentChoice[]>;
  /** The plans the account can see. */
  plans(userId: string): Promise<readonly AutomationPlanReference[]>;
  /** The steps of a plan the account can see; `null` when it cannot see the plan. */
  planSteps(
    userId: string,
    planId: string,
  ): Promise<readonly AutomationChoice[] | null>;
  /** The projects the account can open, with their statuses. */
  projects(userId: string): Promise<readonly AutomationProjectChoice[]>;
  /** The projects the account is a member of. */
  memberProjects(userId: string): Promise<readonly AutomationChoice[]>;
  /** The user groups the account is a member of. */
  groups(userId: string): Promise<readonly AutomationChoice[]>;
  isProjectMember(projectId: string, userId: string): Promise<boolean>;
  isProjectManager(projectId: string, userId: string): Promise<boolean>;
  isGroupMember(groupId: string, userId: string): Promise<boolean>;
  /** The workspaces the account can run scripts in. */
  workspaces(userId: string): Promise<readonly AutomationChoice[]>;
  /** The configured interpreter profiles, without their paths. */
  interpreterProfiles(): Promise<readonly AutomationChoice[]>;
  /** Display names of projects and groups for shared automations. */
  sharingNames(): Promise<ReadonlyMap<string, string>>;
}
