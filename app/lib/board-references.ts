import {
  BOARD_FILTER_ALL,
  BOARD_FILTER_NONE,
} from "@/definition/BoardPreferences";

import type { BoardPreferences } from "@/definition/BoardPreferences";

/** Identifiers of everything a board filter can point to. */
export interface BoardReferences {
  readonly projectIds: ReadonlySet<string>;
  readonly statusIds: ReadonlySet<string>;
  readonly milestoneIds: ReadonlySet<string>;
  readonly labelIds: ReadonlySet<string>;
  readonly departmentIds: ReadonlySet<string>;
  readonly assigneeIds: ReadonlySet<string>;
  readonly groupIds: ReadonlySet<string>;
}

const GROUP_PREFIX = "group:";

function pickKnown(
  value: string,
  known: ReadonlySet<string>,
  keepers: readonly string[] = [],
): string {
  return keepers.includes(value) || known.has(value) ? value : BOARD_FILTER_ALL;
}

function pickAssignee(value: string, references: BoardReferences): string {
  if (value.startsWith(GROUP_PREFIX)) {
    return references.groupIds.has(value.slice(GROUP_PREFIX.length))
      ? value
      : BOARD_FILTER_ALL;
  }

  return pickKnown(value, references.assigneeIds, [BOARD_FILTER_NONE]);
}

/**
 * Drops filter values that point to something the visitor cannot see any more.
 *
 * @param preferences - Valid preferences from the address or the saved ones.
 * @param references - What exists and is visible for the visitor.
 * @returns Preferences where a vanished project, status, milestone, label,
 * department, person or group no longer filters the board, so a saved filter
 * never hides every ticket for a reason the visitor cannot see.
 */
export function sanitizeBoardReferences(
  preferences: BoardPreferences,
  references: BoardReferences,
): BoardPreferences {
  return {
    ...preferences,
    assignee: pickAssignee(preferences.assignee, references),
    department: pickKnown(preferences.department, references.departmentIds, [
      BOARD_FILTER_NONE,
    ]),
    labelIds: preferences.labelIds.filter((labelId) =>
      references.labelIds.has(labelId),
    ),
    milestone: pickKnown(preferences.milestone, references.milestoneIds),
    project: pickKnown(preferences.project, references.projectIds),
    status: pickKnown(preferences.status, references.statusIds),
  };
}
