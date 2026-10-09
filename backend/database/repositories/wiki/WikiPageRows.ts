import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isWikiScope, parseWikiCover } from "@/definition/Wiki";

import type { DatabaseValue } from "@/backend/database/Database";
import type { WikiPage, WikiPageSummary, WikiScope } from "@/definition/Wiki";

/** A page as stored, without the parts derived from other pages. */
export type WikiPageRecord = Omit<WikiPage, "anchors" | "breadcrumb">;

/**
 * Columns every page query selects first, in the order {@link readSummary}
 * expects them. The query joins `users AS owner` and `projects`.
 */
export const WIKI_SUMMARY_COLUMNS = `
    page.id,
    page.title,
    page.icon,
    page.scope,
    page.project_id,
    project.name,
    page.parent_id,
    page.owner_id,
    owner.display_name,
    page.current_until,
    page.updated_at,
    page.created_at
`;

/** Columns that follow {@link WIKI_SUMMARY_COLUMNS} for a full page. */
export const WIKI_PAGE_COLUMNS = `
    ${WIKI_SUMMARY_COLUMNS},
    page.content,
    page.revision,
    page.is_template,
    editor.display_name,
    page.cover
`;

/** Joins that give {@link WIKI_SUMMARY_COLUMNS} their names. */
export const WIKI_PAGE_JOINS = `
    LEFT JOIN users AS owner
        ON owner.id = page.owner_id
    LEFT JOIN users AS editor
        ON editor.id = page.updated_by
    LEFT JOIN projects AS project
        ON project.id = page.project_id
`;

/**
 * Reads a number column.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @param column - Column name used in error messages.
 * @returns The value as a number.
 */
export function readCount(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number {
  const value = row[index];

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error(`Database returned an invalid value for "${column}".`);
}

/**
 * Reads a scope column.
 *
 * @param row - Row returned by a query.
 * @param index - Zero-based column position.
 * @returns The scope.
 */
export function readScope(
  row: readonly DatabaseValue[],
  index: number,
): WikiScope {
  const scope = readTextColumn(row, index, "scope");

  if (!isWikiScope(scope)) {
    throw new Error('Database returned an invalid value for "scope".');
  }

  return scope;
}

/**
 * Reads the summary columns of a page row.
 *
 * @param row - Row selected with {@link WIKI_SUMMARY_COLUMNS}.
 * @returns The page summary.
 */
export function readSummary(row: readonly DatabaseValue[]): WikiPageSummary {
  return {
    id: readTextColumn(row, 0, "id"),
    title: readTextColumn(row, 1, "title"),
    icon: readNullableTextColumn(row, 2, "icon"),
    scope: readScope(row, 3),
    projectId: readNullableTextColumn(row, 4, "project_id"),
    projectName: readNullableTextColumn(row, 5, "project_name"),
    parentId: readNullableTextColumn(row, 6, "parent_id"),
    ownerId: readTextColumn(row, 7, "owner_id"),
    ownerName: readNullableTextColumn(row, 8, "owner_name") ?? "",
    currentUntil: readNullableTextColumn(row, 9, "current_until"),
    updatedAt: readTextColumn(row, 10, "updated_at"),
    createdAt: readTextColumn(row, 11, "created_at"),
  };
}

/**
 * Reads a full page row.
 *
 * @param row - Row selected with {@link WIKI_PAGE_COLUMNS}.
 * @returns The stored page.
 */
export function readPageRecord(row: readonly DatabaseValue[]): WikiPageRecord {
  return {
    ...readSummary(row),
    content: readTextColumn(row, 12, "content"),
    revision: readCount(row, 13, "revision"),
    isTemplate: readCount(row, 14, "is_template") === 1,
    updatedByName: readNullableTextColumn(row, 15, "editor_name"),
    cover: parseWikiCover(readNullableTextColumn(row, 16, "cover")),
  };
}
