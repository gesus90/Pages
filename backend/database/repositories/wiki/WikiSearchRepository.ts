import { readTextColumn } from "@/backend/database/RowValue";

import { escapeLike } from "./WikiLinkRepository";
import {
  readCount,
  readSummary,
  WIKI_PAGE_JOINS,
  WIKI_SUMMARY_COLUMNS,
} from "./WikiPageRows";
import { createVisiblePagesQuery } from "./WikiVisibility";

import type {
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";
import type { WikiPageSummary, WikiVisibilityScope } from "@/definition/Wiki";

/** How hits are ordered. */
export type WikiSearchSort = "relevance" | "edited" | "created";

/** The area a search is limited to. */
export type WikiSearchArea =
  | { readonly scope: "instance" | "private" }
  | { readonly scope: "project"; readonly projectId: string };

/** What a search asks for, already validated by the service. */
export interface WikiSearchFilters {
  /** Words; each must occur in the title or the text. */
  readonly terms: readonly string[];
  /** Phrases; each must occur as written in the title or the text. */
  readonly phrases: readonly string[];
  /** Look in titles only. */
  readonly titleOnly: boolean;
  /** Only pages of this area. */
  readonly area: WikiSearchArea | null;
  /** Only this page and the pages below it. */
  readonly underPageId: string | null;
  /** Only pages created by this account. */
  readonly creatorId: string | null;
  /** Only pages edited on or after this date (`YYYY-MM-DD`). */
  readonly editedFrom: string | null;
  /** Only pages edited on or before this date (`YYYY-MM-DD`). */
  readonly editedTo: string | null;
  readonly sort: WikiSearchSort;
  readonly limit: number;
}

/** A page that matched, with its text for the snippet. */
export interface WikiSearchHit extends WikiPageSummary {
  readonly content: string;
}

interface SqlPart {
  readonly sql: string;
  readonly parameters: SqlParameters;
}

interface MatchPart extends SqlPart {
  /** Expression that ranks a page: 10 per title hit, 1 per text hit. */
  readonly score: string;
}

const ORDER: Readonly<Record<WikiSearchSort, string>> = {
  created: "page.created_at DESC, page.id",
  edited: "page.updated_at DESC, page.id",
  relevance: "score DESC, page.updated_at DESC, page.id",
};

function matchTerm(index: number, titleOnly: boolean): string {
  return titleOnly
    ? `page.title ILIKE $match_${index} ESCAPE '\\'`
    : `(page.title ILIKE $match_${index} ESCAPE '\\' OR page.content ILIKE $match_${index} ESCAPE '\\')`;
}

function createMatch(filters: WikiSearchFilters): MatchPart {
  const needles = [...filters.terms, ...filters.phrases];
  const parameters = Object.fromEntries(
    needles.map((needle, index): [string, string] => [
      `match_${index}`,
      `%${escapeLike(needle)}%`,
    ]),
  );
  const score = needles.map(
    (_, index) =>
      `(CASE WHEN page.title ILIKE $match_${index} ESCAPE '\\' THEN 10 ELSE 0 END${
        filters.titleOnly
          ? ""
          : ` + CASE WHEN page.content ILIKE $match_${index} ESCAPE '\\' THEN 1 ELSE 0 END`
      })`,
  );

  return {
    parameters,
    score: ["0", ...score].join(" + "),
    sql: needles
      .map((_, index) => `AND ${matchTerm(index, filters.titleOnly)}`)
      .join("\n"),
  };
}

function createFilters(filters: WikiSearchFilters): SqlPart {
  const conditions: string[] = [];
  const parameters: Record<string, string> = {};

  if (filters.area) {
    conditions.push("AND page.scope = $area_scope");
    parameters.area_scope = filters.area.scope;

    if (filters.area.scope === "project") {
      conditions.push("AND page.project_id = $area_project");
      parameters.area_project = filters.area.projectId;
    }
  }

  if (filters.creatorId !== null) {
    conditions.push("AND page.author_id = $creator_id");
    parameters.creator_id = filters.creatorId;
  }

  if (filters.editedFrom !== null) {
    conditions.push("AND page.updated_at >= $edited_from");
    parameters.edited_from = filters.editedFrom;
  }

  if (filters.editedTo !== null) {
    conditions.push("AND page.updated_at < $edited_to");
    parameters.edited_to = `${filters.editedTo} 23:59:59.999999`;
  }

  if (filters.underPageId !== null) {
    conditions.push(`AND (
        page.id = $under_id
        OR page.id IN (
            WITH RECURSIVE subtree (id) AS (
                SELECT child.id
                FROM wiki_pages AS child
                WHERE child.parent_id = $under_id
                UNION ALL
                SELECT child.id
                FROM wiki_pages AS child
                INNER JOIN subtree
                    ON child.parent_id = subtree.id
            )
            SELECT id FROM subtree
        )
    )`);
    parameters.under_id = filters.underPageId;
  }

  return { parameters, sql: conditions.join("\n") };
}

/** Owns the text search over the pages a viewer may see. */
export class WikiSearchRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Searches the pages a viewer may see.
   *
   * @param scope - What the viewer may see.
   * @param filters - The words, phrases and filters.
   * @returns The best hits and the number of all hits. The visibility filter
   * runs before matching, ranking and counting, so neither a hit nor the
   * count can reveal a hidden page.
   */
  public async search(
    scope: WikiVisibilityScope,
    filters: WikiSearchFilters,
  ): Promise<{ hits: WikiSearchHit[]; total: number }> {
    const visible = createVisiblePagesQuery(scope);
    const match = createMatch(filters);
    const narrowed = createFilters(filters);
    const parameters = {
      ...visible.parameters,
      ...match.parameters,
      ...narrowed.parameters,
    };
    const where = `
        WHERE page.is_template = 0
        ${match.sql}
        ${narrowed.sql}
    `;
    const [hitRows, countRows] = await Promise.all([
      this.database.query(
        `
          ${visible.sql}
          SELECT
              ${WIKI_SUMMARY_COLUMNS},
              page.content,
              ${match.score} AS score
          FROM wiki_pages AS page
          INNER JOIN visible_pages
              ON visible_pages.id = page.id
          ${WIKI_PAGE_JOINS}
          ${where}
          ORDER BY ${ORDER[filters.sort]}
          LIMIT ${Math.trunc(filters.limit)};
        `,
        parameters,
      ),
      this.database.query(
        `
          ${visible.sql}
          SELECT COUNT(*)
          FROM wiki_pages AS page
          INNER JOIN visible_pages
              ON visible_pages.id = page.id
          ${where};
        `,
        parameters,
      ),
    ]);
    const [countRow = []] = countRows;

    return {
      hits: hitRows.map((row) => ({
        ...readSummary(row),
        content: readTextColumn(row, 12, "content"),
      })),
      total: readCount(countRow, 0, "count"),
    };
  }

  /**
   * Finds visible pages by title, for the reference picker.
   *
   * @param scope - What the viewer may see.
   * @param query - Text typed after the trigger.
   * @param limit - Largest number of pages.
   * @returns Pages whose title contains the text, best edited first.
   */
  public async searchTitles(
    scope: WikiVisibilityScope,
    query: string,
    limit: number,
  ): Promise<{ id: string; title: string; icon: string | null }[]> {
    const { hits } = await this.search(scope, {
      area: null,
      creatorId: null,
      editedFrom: null,
      editedTo: null,
      limit,
      phrases: [],
      sort: "edited",
      terms: query.trim() === "" ? [] : [query.trim()],
      titleOnly: true,
      underPageId: null,
    });

    return hits.map(({ icon, id, title }) => ({ icon, id, title }));
  }
}
