/** A named set of people that tickets can be assigned to as a whole. */
export interface UserGroup {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
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
  readonly canEdit: boolean;
}

/** Server-filtered view model of the group management section. */
export interface GroupPageData {
  readonly canManage: boolean;
  readonly groups: readonly ManagedGroup[];
}

/** The longest group name accepted. */
export const MAX_GROUP_NAME_LENGTH = 200;
