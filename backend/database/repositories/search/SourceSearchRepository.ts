import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  createTicketVisibility,
  escapeLike,
} from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { createVisiblePagesQuery } from "@/backend/database/repositories/wiki/WikiVisibility";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, SqlParameters } from "@/backend/database/Database";
import type {
  SearchEmbeddingSourceKey,
  VisibleSourceQuery,
} from "@/backend/database/repositories/search/SearchEmbeddingRepository";
import type { WikiVisibilityScope } from "@/definition/Wiki";

/** Who searches and where; resolved on the server for every search. */
export interface SourceSearchArea {
  readonly scope: WikiVisibilityScope;
  /** Only sources of this project; `null` searches every readable source. */
  readonly projectId: string | null;
}

/** A ticket as the reader may see it now. */
export interface CurrentTicketSource {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly projectId: string;
}

/** A wiki page as the reader may see it now. */
export interface CurrentWikiPageSource {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly revision: number;
  readonly projectId: string | null;
}

/** A released ticket asset the reader may see now, without its bytes. */
export interface CurrentAssetSource {
  readonly id: string;
  readonly fileName: string;
  /** SHA-256 of the bytes; it is the version of the asset. */
  readonly checksum: string;
  readonly ticketKey: string;
  readonly projectId: string;
}

/** The current state of the candidate sources the reader may see. */
export interface CurrentSources {
  readonly tickets: readonly CurrentTicketSource[];
  readonly pages: readonly CurrentWikiPageSource[];
  readonly assets: readonly CurrentAssetSource[];
}

/** Placeholder of the project limit, shared by every part of the visibility. */
const PROJECT_PARAMETER = "search_project_id";

function projectCondition(column: string, area: SourceSearchArea): string {
  return area.projectId === null ? "" : `AND ${column} = $${PROJECT_PARAMETER}`;
}

function projectParameters(area: SourceSearchArea): SqlParameters {
  return area.projectId === null ? {} : { [PROJECT_PARAMETER]: area.projectId };
}

/**
 * Lists the `(source_type, source_id)` pairs a reader may see now.
 * @param area - The resolved scope of the reader and an optional project.
 * @returns A query for {@link VisibleSourceQuery} built from the visibility of
 * the wiki search and of the ticket search: visible wiki pages that are no
 * templates, active tickets of readable projects and departments, and released
 * assets of such tickets. With a project only its tickets, their assets and
 * its project pages are listed.
 */
export function createVisibleSourceQuery(
  area: SourceSearchArea,
): VisibleSourceQuery {
  const pages = createVisiblePagesQuery(area.scope);
  const tickets = createTicketVisibility(area.scope);
  const pageProject =
    area.projectId === null
      ? ""
      : `AND visible_page.scope = 'project' ${projectCondition("visible_page.project_id", area)}`;
  return {
    sql: `
      ${pages.sql}
      SELECT
          'wiki_page'::TEXT AS source_type,
          visible_page.id AS source_id
      FROM wiki_pages AS visible_page
      INNER JOIN visible_pages
          ON visible_pages.id = visible_page.id
      WHERE visible_page.is_template = 0
          ${pageProject}
      UNION ALL
      SELECT
          'ticket'::TEXT,
          work_items.id
      FROM work_items
      WHERE work_items.archived_at IS NULL
          AND ${tickets.condition}
          ${projectCondition("work_items.project_id", area)}
      UNION ALL
      SELECT
          'ticket_asset'::TEXT,
          attachment.id
      FROM work_item_attachments AS attachment
      INNER JOIN ticket_asset_search_releases AS release
          ON release.attachment_id = attachment.id
      INNER JOIN work_items
          ON work_items.id = attachment.work_item_id
      WHERE work_items.archived_at IS NULL
          AND ${tickets.condition}
          ${projectCondition("work_items.project_id", area)}
    `,
    parameters: {
      ...pages.parameters,
      ...tickets.parameters,
      ...projectParameters(area),
    },
  };
}

function idsOf(
  keys: readonly SearchEmbeddingSourceKey[],
  sourceType: SearchEmbeddingSourceKey["sourceType"],
): string[] {
  return [
    ...new Set(
      keys
        .filter((key) => key.sourceType === sourceType)
        .map((key) => key.sourceId),
    ),
  ];
}

/**
 * Reads the candidates of the keyword search for tickets and the current
 * state of every candidate source, always inside the visibility of the reader.
 * @remarks
 * Every query applies the visibility in its `WHERE` clause, so a source the
 * reader may no longer see is neither found nor read, from the next search on.
 */
export class SourceSearchRepository {
  private readonly database: Database;

  /**
   * Creates the repository.
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Finds the visible active tickets whose key equals one of the given keys.
   * @param area - Reader and optional project.
   * @param keys - Ticket keys as written in the question.
   * @returns Identifiers in the order of `keys`; hidden and unknown keys are left out.
   */
  public async findTicketsByKey(
    area: SourceSearchArea,
    keys: readonly string[],
  ): Promise<string[]> {
    if (keys.length === 0) return [];
    const visibility = createTicketVisibility(area.scope);
    const wanted = createInClause(
      "searched_key",
      keys.map((key) => key.toUpperCase()),
    );
    const rows = await this.database.query(
      `
        SELECT
            work_items.id,
            upper(work_items."key") AS normalized_key
        FROM work_items
        WHERE upper(work_items."key") IN (${wanted.placeholders})
            AND work_items.archived_at IS NULL
            AND ${visibility.condition}
            ${projectCondition("work_items.project_id", area)};
      `,
      {
        ...visibility.parameters,
        ...wanted.parameters,
        ...projectParameters(area),
      },
    );
    const byKey = new Map(
      rows.map((row) => [
        readTextColumn(row, 1, "normalized_key"),
        readTextColumn(row, 0, "id"),
      ]),
    );
    return keys.flatMap((key) => byKey.get(key.toUpperCase()) ?? []);
  }

  /**
   * Searches the key, title and description of the visible active tickets.
   * @param area - Reader and optional project.
   * @param needles - Words and phrases; each must occur, without regard to case.
   * @param limit - Largest number of tickets.
   * @returns Identifiers, best first: 10 per needle in key or title, 1 per needle in the description.
   */
  public async searchTickets(
    area: SourceSearchArea,
    needles: readonly string[],
    limit: number,
  ): Promise<string[]> {
    if (needles.length === 0) return [];
    const visibility = createTicketVisibility(area.scope);
    const patterns = Object.fromEntries(
      needles.map((needle, index): [string, string] => [
        `ticket_match_${index}`,
        `%${escapeLike(needle)}%`,
      ]),
    );
    const names = Object.keys(patterns);
    const heading = (name: string): string =>
      `(work_items."key" ILIKE $${name} ESCAPE '\\' OR work_items.title ILIKE $${name} ESCAPE '\\')`;
    const description = (name: string): string =>
      `work_items.description ILIKE $${name} ESCAPE '\\'`;
    const rows = await this.database.query(
      `
        SELECT
            work_items.id,
            ${names
              .map(
                (name) =>
                  `(CASE WHEN ${heading(name)} THEN 10 ELSE 0 END + CASE WHEN ${description(name)} THEN 1 ELSE 0 END)`,
              )
              .join(" + ")} AS score
        FROM work_items
        WHERE work_items.archived_at IS NULL
            AND ${visibility.condition}
            ${projectCondition("work_items.project_id", area)}
            ${names.map((name) => `AND (${heading(name)} OR ${description(name)})`).join("\n")}
        ORDER BY
            score DESC,
            work_items."key"
        LIMIT ${Math.trunc(limit)};
      `,
      { ...visibility.parameters, ...patterns, ...projectParameters(area) },
    );
    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /**
   * Reads the current state of candidate sources the reader may see now.
   * @param visible - Visibility of the reader, see {@link createVisibleSourceQuery}.
   * @param keys - Candidate sources of every kind.
   * @returns Current text and revision of the visible candidates; hidden,
   * deleted, archived and withdrawn ones are left out.
   */
  public async readCurrentSources(
    visible: VisibleSourceQuery,
    keys: readonly SearchEmbeddingSourceKey[],
  ): Promise<CurrentSources> {
    const [tickets, pages, assets] = await Promise.all([
      this.readTickets(visible, idsOf(keys, "ticket")),
      this.readPages(visible, idsOf(keys, "wiki_page")),
      this.readAssets(visible, idsOf(keys, "ticket_asset")),
    ]);
    return { tickets, pages, assets };
  }

  private async readTickets(
    visible: VisibleSourceQuery,
    ids: readonly string[],
  ): Promise<CurrentTicketSource[]> {
    if (ids.length === 0) return [];
    const candidates = createInClause("candidate_ticket", ids);
    const rows = await this.database.query(
      `
        SELECT
            ticket.id,
            ticket."key",
            ticket.title,
            ticket.description,
            ticket.project_id
        FROM work_items AS ticket
        WHERE ticket.id IN (${candidates.placeholders})
            AND ('ticket', ticket.id) IN (${visible.sql});
      `,
      { ...visible.parameters, ...candidates.parameters },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 1, "key"),
      title: readTextColumn(row, 2, "title"),
      description: readTextColumn(row, 3, "description"),
      projectId: readTextColumn(row, 4, "project_id"),
    }));
  }

  private async readPages(
    visible: VisibleSourceQuery,
    ids: readonly string[],
  ): Promise<CurrentWikiPageSource[]> {
    if (ids.length === 0) return [];
    const candidates = createInClause("candidate_page", ids);
    const rows = await this.database.query(
      `
        SELECT
            candidate_page.id,
            candidate_page.title,
            candidate_page."content",
            candidate_page.revision,
            candidate_page.project_id
        FROM wiki_pages AS candidate_page
        WHERE candidate_page.id IN (${candidates.placeholders})
            AND ('wiki_page', candidate_page.id) IN (${visible.sql});
      `,
      { ...visible.parameters, ...candidates.parameters },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      title: readTextColumn(row, 1, "title"),
      content: readTextColumn(row, 2, "content"),
      revision: readCountColumn(row, 3, "revision"),
      projectId: readNullableTextColumn(row, 4, "project_id"),
    }));
  }

  private async readAssets(
    visible: VisibleSourceQuery,
    ids: readonly string[],
  ): Promise<CurrentAssetSource[]> {
    if (ids.length === 0) return [];
    const candidates = createInClause("candidate_asset", ids);
    const rows = await this.database.query(
      `
        SELECT
            asset.id,
            asset.file_name,
            asset.checksum,
            ticket."key",
            ticket.project_id
        FROM work_item_attachments AS asset
        INNER JOIN work_items AS ticket
            ON ticket.id = asset.work_item_id
        WHERE asset.id IN (${candidates.placeholders})
            AND ('ticket_asset', asset.id) IN (${visible.sql});
      `,
      { ...visible.parameters, ...candidates.parameters },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      fileName: readTextColumn(row, 1, "file_name"),
      checksum: readTextColumn(row, 2, "checksum"),
      ticketKey: readTextColumn(row, 3, "key"),
      projectId: readTextColumn(row, 4, "project_id"),
    }));
  }
}
