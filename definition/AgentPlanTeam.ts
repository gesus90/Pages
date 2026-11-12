/** Whether a team entry names a group or a department. */
export type AgentPlanTeamKind = "group" | "department";

/**
 * One team of a plan: a group or a department and what its members may do (PAGE-329).
 *
 * @remarks
 * Members and leaders of the group or department who can open the project of
 * the plan get the rights of the entry. Changing or running implies reading.
 * Every operation still checks agents, models, tickets and workspaces for the
 * person who performs it; a team never delegates credentials.
 */
export interface AgentPlanTeam {
  readonly kind: AgentPlanTeamKind;
  readonly targetId: string;
  readonly canRead: boolean;
  readonly canEdit: boolean;
  readonly canRun: boolean;
}

/** The rights a person has on one plan, as the server decided them for this request. */
export interface AgentPlanRightsView {
  readonly canRead: boolean;
  readonly canEdit: boolean;
  readonly canRun: boolean;
  /** Owner, active administrator or project manager: may change the teams of the plan. */
  readonly canManageTeams: boolean;
  /** Only an active human administrator changes the owner. */
  readonly canChangeOwner: boolean;
  /** The owner or an active human administrator deletes the plan. */
  readonly canDelete: boolean;
  /** An active human administrator, who needs no script approval and controls every run. */
  readonly isAdministrator: boolean;
  /** The rights come from the administrator role alone: the plan is somebody else's. */
  readonly isAdminAccess: boolean;
}

/** One action recorded in the history of a plan. */
export type AgentPlanAuditAction =
  | "teams_changed"
  | "owner_changed"
  | "script_approved"
  | "admin_saved"
  | "admin_started"
  | "admin_run_controlled"
  | "admin_deleted";

/** An entry of the history of a plan: who did what, when, at which revision. */
export interface AgentPlanAuditEntry {
  readonly id: string;
  readonly planId: string;
  readonly actorId: string;
  /** The display name of the actor now, or the identifier when nobody can name it. */
  readonly actorName: string;
  readonly action: AgentPlanAuditAction;
  readonly revision: number;
  readonly createdAt: string;
  /** What changed, for example the new teams, the owners or the approved hash. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** The approval state of the script steps of a plan. */
export interface AgentPlanScriptApprovalState {
  /** Whether the plan has local, active script steps at all. */
  readonly hasScripts: boolean;
  /** The script steps whose current content no administrator approved. */
  readonly unapprovedStepIds: readonly string[];
}

/** The most team entries one plan holds. */
export const AGENT_PLAN_TEAM_LIMIT = 50;

const TEAM_KINDS: readonly string[] = ["group", "department"];

/** Narrows a value to a team kind. */
export function isAgentPlanTeamKind(
  value: unknown,
): value is AgentPlanTeamKind {
  return typeof value === "string" && TEAM_KINDS.includes(value);
}

/**
 * Returns the teams as they are stored: each target once, reading implied by
 * changing or running, and no entry without any right.
 *
 * @param teams - The proposed entries in their order.
 */
export function normalizePlanTeams(
  teams: readonly AgentPlanTeam[],
): readonly AgentPlanTeam[] {
  const seen = new Set<string>();
  const normalized: AgentPlanTeam[] = [];
  for (const team of teams) {
    const key = `${team.kind}:${team.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const canRead = team.canRead || team.canEdit || team.canRun;
    if (!canRead) continue;
    normalized.push({ ...team, canRead });
  }
  return normalized;
}

/** A team entry with all three rights, the default of a new entry. */
export function fullPlanTeam(
  kind: AgentPlanTeamKind,
  targetId: string,
): AgentPlanTeam {
  return { kind, targetId, canRead: true, canEdit: true, canRun: true };
}

/**
 * The teams of a plan, also for plans read before team lists existed.
 *
 * @param plan - A plan with its team list, or only its legacy department.
 * @returns The stored list, or the legacy department as one full entry.
 */
export function planTeamsOf(plan: {
  readonly teams?: readonly AgentPlanTeam[];
  readonly departmentId?: string | null;
}): readonly AgentPlanTeam[] {
  if (plan.teams) return plan.teams;
  return plan.departmentId
    ? [fullPlanTeam("department", plan.departmentId)]
    : [];
}

/**
 * The department that is the name space of a plan: the first department entry.
 *
 * @returns Its identifier, or `null` for a plan without a department team.
 */
export function planNameDepartment(
  teams: readonly AgentPlanTeam[],
): string | null {
  return teams.find((team) => team.kind === "department")?.targetId ?? null;
}

/**
 * Whether the person runs the plan: Play, Pause, Resume and Stop of own runs.
 *
 * @remarks
 * Views made before team rights only carry `canEdit`, which meant changing and
 * running alike; it decides for them.
 */
export function canRunPlan(plan: {
  readonly canEdit: boolean;
  readonly rights?: Pick<AgentPlanRightsView, "canRun">;
}): boolean {
  return plan.rights?.canRun ?? plan.canEdit;
}

/** Whether the person is an active human administrator for this plan request. */
export function isPlanAdministrator(plan: {
  readonly rights?: Pick<AgentPlanRightsView, "isAdministrator">;
}): boolean {
  return plan.rights?.isAdministrator === true;
}
