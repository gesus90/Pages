import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import type { BoardGroup } from "@/definition/BoardPreferences";
import type {
  Label,
  WorkItemDetail,
  WorkItemPriority,
} from "@/definition/Task";

/** The key of the section that collects tickets without the grouped property. */
export const BOARD_GROUP_NONE_KEY = "none";

/** One section of the grouped kanban board. */
export interface BoardGroupSection {
  readonly key: string;
  readonly kind: BoardGroup;
  /** The name of the group; `null` for sections the view names itself. */
  readonly title: string | null;
  readonly items: readonly WorkItemDetail[];
}

/** What the group names come from besides the tickets themselves. */
export interface BoardGroupLookups {
  readonly labelsByWorkItem: Readonly<Record<string, readonly Label[]>>;
  readonly departmentNames: Readonly<Record<string, string>>;
}

interface GroupKey {
  readonly key: string;
  readonly title: string | null;
}

const PRIORITY_ORDER: readonly WorkItemPriority[] = [
  WORK_ITEM_PRIORITY.URGENT,
  WORK_ITEM_PRIORITY.HIGH,
  WORK_ITEM_PRIORITY.NORMAL,
  WORK_ITEM_PRIORITY.LOW,
];

const NO_GROUP: GroupKey = { key: BOARD_GROUP_NONE_KEY, title: null };

function assigneeKey(item: WorkItemDetail): GroupKey {
  if (item.assigneeGroupId !== null) {
    return {
      key: `group:${item.assigneeGroupId}`,
      title: item.assigneeGroupName,
    };
  }

  return item.assigneeId === null
    ? NO_GROUP
    : { key: item.assigneeId, title: item.assigneeName };
}

function keysOf(
  item: WorkItemDetail,
  group: BoardGroup,
  lookups: BoardGroupLookups,
): readonly GroupKey[] {
  switch (group) {
    case "project":
      return [{ key: item.projectId, title: item.projectName }];
    case "priority":
      return [{ key: item.priority, title: null }];
    case "assignee":
      return [assigneeKey(item)];
    case "department":
      return [
        item.departmentId === null
          ? NO_GROUP
          : {
              key: item.departmentId,
              title: lookups.departmentNames[item.departmentId] ?? null,
            },
      ];
    case "label": {
      const labels = lookups.labelsByWorkItem[item.id] ?? [];

      return labels.length === 0
        ? [NO_GROUP]
        : labels.map((label) => ({ key: label.id, title: label.name }));
    }
    case "none":
      return [NO_GROUP];
  }
}

function compareSections(
  first: BoardGroupSection,
  second: BoardGroupSection,
): number {
  if (first.kind === "priority") {
    return (
      PRIORITY_ORDER.findIndex((priority) => priority === first.key) -
      PRIORITY_ORDER.findIndex((priority) => priority === second.key)
    );
  }

  if (
    first.key === BOARD_GROUP_NONE_KEY ||
    second.key === BOARD_GROUP_NONE_KEY
  ) {
    return first.key === BOARD_GROUP_NONE_KEY ? 1 : -1;
  }

  return (first.title ?? "").localeCompare(second.title ?? "");
}

/**
 * Splits the tickets of the board into the sections of one grouping.
 *
 * @param items - Tickets in the order they should keep inside a section.
 * @param group - What to group by; `none` yields a single, untitled section.
 * @param lookups - Names the tickets do not carry themselves.
 * @returns Sections ordered by name, priority by urgency and the section of
 * ungrouped tickets last. A ticket with several labels appears in each label's
 * section.
 */
export function groupWorkItems(
  items: readonly WorkItemDetail[],
  group: BoardGroup,
  lookups: BoardGroupLookups,
): BoardGroupSection[] {
  const sections = new Map<
    string,
    { title: string | null; items: WorkItemDetail[] }
  >();

  for (const item of items) {
    for (const { key, title } of keysOf(item, group, lookups)) {
      const section = sections.get(key) ?? { items: [], title };

      section.items.push(item);
      sections.set(key, section);
    }
  }

  const result = Array.from(sections, ([key, section]) => ({
    items: section.items,
    key,
    kind: group,
    title: section.title,
  }));

  return group === "none" ? result : result.sort(compareSections);
}
