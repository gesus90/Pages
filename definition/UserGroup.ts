/** A named set of people that tickets can be assigned to as a whole. */
export interface UserGroup {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
  /**
   * Members that lead the group (PAGE-308), a subset of `memberIds`.
   *
   * @remarks
   * Absent means none when a group is read; when a group is saved, absent
   * keeps the stored leadership, so a change of name or members never drops
   * it. Only an administrator sets it.
   */
  readonly leaderIds?: readonly string[];
}

/** A group as ticket forms offer it; a group without members cannot be assigned. */
export interface GroupSummary {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

/** A group in the management view, with the hints computed by the server policy. */
export interface ManagedGroup extends GroupSummary {
  /** Members the actor may see; others are counted in `memberCount` only. */
  readonly memberIds: readonly string[];
  /** Leaders of the group, as far as the actor may see them. */
  readonly leaderIds: readonly string[];
  readonly canEdit: boolean;
  /** Whether the actor may read the agent profiles of the group (PAGE-308). */
  readonly canReadAgents: boolean;
}

/** Server-filtered view model of the group management section. */
export interface GroupPageData {
  readonly canManage: boolean;
  /** Whether the actor sets group leaders: administrators only. */
  readonly canSetLeaders: boolean;
  readonly groups: readonly ManagedGroup[];
}

/** The longest group name accepted. */
export const MAX_GROUP_NAME_LENGTH = 200;
