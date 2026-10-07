/** The ways the task page can show the work items. */
export const BOARD_VIEWS = [
  "kanban",
  "list",
  "hierarchy",
  "milestones",
  "github",
] as const;

/** One of the task views. */
export type BoardView = (typeof BOARD_VIEWS)[number];

/** Whose tickets the board shows. */
export const BOARD_SCOPES = ["all", "mine"] as const;

/** Whose tickets the board shows. */
export type BoardScope = (typeof BOARD_SCOPES)[number];

/**
 * Which ticket types the board shows; `work` is the default of tasks and subtasks.
 */
export const BOARD_TYPE_FILTERS = [
  "work",
  "all",
  "initiative",
  "epic",
  "task",
  "subtask",
] as const;

/** Which ticket types the board shows. */
export type BoardTypeFilter = (typeof BOARD_TYPE_FILTERS)[number];

const BOARD_PRIORITY_FILTERS = [
  "all",
  "urgent",
  "high",
  "normal",
  "low",
] as const;

/** Which priority the board shows. */
export type BoardPriorityFilter = (typeof BOARD_PRIORITY_FILTERS)[number];

/** Orders a ticket list can take; `manual` is the drag order of the columns. */
export const BOARD_SORT_FIELDS = [
  "manual",
  "updated",
  "priority",
  "dueDate",
  "title",
  "project",
  "status",
] as const;

/** An order the board can sort its tickets by. */
export type BoardSortField = (typeof BOARD_SORT_FIELDS)[number];

/** Direction a sorted board runs in. */
export const BOARD_SORT_DIRECTIONS = ["asc", "desc"] as const;

/** Direction a sorted board runs in. */
export type BoardSortDirection = (typeof BOARD_SORT_DIRECTIONS)[number];

/** What the kanban board groups its columns by. */
export const BOARD_GROUPS = [
  "none",
  "project",
  "priority",
  "assignee",
  "department",
  "label",
] as const;

/** What the kanban board groups its columns by. */
export type BoardGroup = (typeof BOARD_GROUPS)[number];

/** The value of a filter that lets everything through. */
export const BOARD_FILTER_ALL = "all";

/** The value of the assignee and department filters that select tickets without one. */
export const BOARD_FILTER_NONE = "none";

/** Everything the board remembers about how the visitor looks at it. */
export interface BoardPreferences {
  readonly view: BoardView;
  readonly scope: BoardScope;
  readonly project: string;
  readonly type: BoardTypeFilter;
  readonly status: string;
  readonly priority: BoardPriorityFilter;
  readonly milestone: string;
  /** `all`, `none`, a user id or `group:<id>`. */
  readonly assignee: string;
  /** `all`, `none` or a department id. */
  readonly department: string;
  /** Tickets with any of these labels pass; empty lets every ticket pass. */
  readonly labelIds: readonly string[];
  readonly search: string;
  readonly sort: BoardSortField;
  readonly direction: BoardSortDirection;
  readonly group: BoardGroup;
}

/** What the board shows before the visitor chose anything. */
export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  assignee: BOARD_FILTER_ALL,
  department: BOARD_FILTER_ALL,
  direction: "asc",
  group: "none",
  labelIds: [],
  milestone: BOARD_FILTER_ALL,
  priority: "all",
  project: BOARD_FILTER_ALL,
  scope: "all",
  search: "",
  sort: "manual",
  status: BOARD_FILTER_ALL,
  type: "work",
  view: "kanban",
};

const MAX_LABEL_FILTERS = 20;
const MAX_SEARCH_LENGTH = 200;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ASSIGNEE_PATTERN = /^(?:group:)?[A-Za-z0-9_-]{1,64}$/;

/** Query parameter of every preference; all of them together form the board address. */
const QUERY_KEYS = {
  assignee: "assignee",
  department: "department",
  direction: "dir",
  group: "group",
  labelIds: "labels",
  milestone: "milestone",
  priority: "priority",
  project: "project",
  scope: "scope",
  search: "q",
  sort: "sort",
  status: "status",
  type: "type",
  view: "view",
} as const satisfies Record<keyof BoardPreferences, string>;

function pickOption<Option extends string>(
  value: unknown,
  options: readonly Option[],
  fallback: Option,
): Option {
  return options.find((option) => option === value) ?? fallback;
}

function pickPattern(
  value: unknown,
  pattern: RegExp,
  extraValues: readonly string[],
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return extraValues.includes(value) || pattern.test(value) ? value : null;
}

function pickLabelIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const valid = value.filter(
    (labelId): labelId is string =>
      typeof labelId === "string" && IDENTIFIER_PATTERN.test(labelId),
  );

  return Array.from(new Set(valid)).slice(0, MAX_LABEL_FILTERS);
}

/**
 * Turns an untrusted value into complete, valid board preferences.
 *
 * @param raw - A stored or submitted object; anything else counts as empty.
 * @returns Preferences where every missing or invalid field has its default.
 */
export function normalizeBoardPreferences(raw: unknown): BoardPreferences {
  const source: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? { ...raw } : {};
  const defaults = DEFAULT_BOARD_PREFERENCES;
  const identifier = (
    value: unknown,
    extraValues: readonly string[] = [BOARD_FILTER_ALL],
  ): string =>
    pickPattern(value, IDENTIFIER_PATTERN, extraValues) ?? BOARD_FILTER_ALL;

  return {
    assignee:
      pickPattern(source.assignee, ASSIGNEE_PATTERN, [
        BOARD_FILTER_ALL,
        BOARD_FILTER_NONE,
      ]) ?? defaults.assignee,
    department: identifier(source.department, [
      BOARD_FILTER_ALL,
      BOARD_FILTER_NONE,
    ]),
    direction: pickOption(
      source.direction,
      BOARD_SORT_DIRECTIONS,
      defaults.direction,
    ),
    group: pickOption(source.group, BOARD_GROUPS, defaults.group),
    labelIds: pickLabelIds(source.labelIds),
    milestone: identifier(source.milestone),
    priority: pickOption(
      source.priority,
      BOARD_PRIORITY_FILTERS,
      defaults.priority,
    ),
    project: identifier(source.project),
    scope: pickOption(source.scope, BOARD_SCOPES, defaults.scope),
    search:
      typeof source.search === "string"
        ? source.search.slice(0, MAX_SEARCH_LENGTH)
        : defaults.search,
    sort: pickOption(source.sort, BOARD_SORT_FIELDS, defaults.sort),
    status: identifier(source.status),
    type: pickOption(source.type, BOARD_TYPE_FILTERS, defaults.type),
    view: pickOption(source.view, BOARD_VIEWS, defaults.view),
  };
}

/**
 * Tells whether an address carries any board preference.
 *
 * @param params - Query parameters of the request.
 */
export function hasBoardQuery(params: URLSearchParams): boolean {
  return Object.values(QUERY_KEYS).some((key) => params.has(key));
}

/**
 * Removes every board preference from the parameters of an address.
 *
 * @param params - Query parameters of the request.
 * @returns A copy that keeps only the other parameters, such as the open ticket.
 */
export function withoutBoardQuery(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);

  for (const key of Object.values(QUERY_KEYS)) {
    next.delete(key);
  }

  return next;
}

/**
 * Reads the board preferences out of an address.
 *
 * @param params - Query parameters of the request.
 * @param base - Preferences for the parameters the address does not carry,
 * usually the saved ones.
 * @returns Valid preferences; a carried parameter with an invalid value falls
 * back to the default, not to the base.
 */
export function parseBoardQuery(
  params: URLSearchParams,
  base: BoardPreferences,
): BoardPreferences {
  const merged: Record<string, unknown> = { ...base };

  for (const [field, key] of Object.entries(QUERY_KEYS)) {
    const value = params.get(key);

    if (value !== null) {
      merged[field] =
        field === "labelIds" ? value.split(",").filter(Boolean) : value;
    }
  }

  return normalizeBoardPreferences(merged);
}

/**
 * Writes every board preference into the parameters of an address.
 *
 * @param params - Parameters of the current address; other parameters stay.
 * @param preferences - Preferences to write.
 * @returns A copy with all board parameters set, defaults included, so the
 * address never depends on what is saved.
 */
export function withBoardQuery(
  params: URLSearchParams,
  preferences: BoardPreferences,
): URLSearchParams {
  const next = new URLSearchParams(params);

  for (const [field, key] of Object.entries(QUERY_KEYS)) {
    const value = preferences[field as keyof BoardPreferences];

    next.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }

  return next;
}

/**
 * Turns preferences into the text the database stores.
 *
 * @param preferences - Preferences to store.
 */
export function serializeBoardPreferences(
  preferences: BoardPreferences,
): string {
  return JSON.stringify(normalizeBoardPreferences(preferences));
}

/**
 * Reads stored preferences back; damaged text counts as nothing saved.
 *
 * @param text - Text written by {@link serializeBoardPreferences}.
 */
export function parseStoredBoardPreferences(text: string): BoardPreferences {
  try {
    return normalizeBoardPreferences(JSON.parse(text));
  } catch {
    // Text that is no JSON can only come from a damaged row; start from the defaults.
    return DEFAULT_BOARD_PREFERENCES;
  }
}
