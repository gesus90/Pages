import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

/**
 * The current state of one searchable source, read without its text.
 * @remarks
 * For tickets and wiki pages `contentHash` is the SHA-256 of the text the
 * indexer embeds, computed by PostgreSQL in the form
 * {@link ticketSearchText} and {@link wikiPageSearchText} build, so the
 * indexer reads the text only of new and changed sources. For ticket assets
 * it is the SHA-256 of the bytes, which never change under an attachment.
 */
export interface SearchSourceState {
  readonly sourceType: "ticket" | "wiki_page" | "ticket_asset";
  readonly sourceId: string;
  readonly contentHash: string;
}

/** The text of a ticket the indexer embeds. */
export interface TicketSearchSource {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string;
}

/** The text of a wiki page the indexer embeds, with the page revision. */
export interface WikiPageSearchSource {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly revision: number;
}

/** A ticket asset released for the search, without its bytes. */
export interface ReleasedTicketAsset {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  /** SHA-256 of the bytes; it is the version of the asset. */
  readonly checksum: string;
}

/**
 * Builds the text the indexer embeds for a ticket.
 * @param ticket - Key, title and description of the ticket.
 * @returns The key and title as the first paragraph, then the description.
 * @remarks
 * The SQL of {@link SearchSourceRepository.listSourceStates} hashes the same
 * concatenation; both must change together.
 */
export function ticketSearchText(ticket: TicketSearchSource): string {
  return `${ticket.key}: ${ticket.title}\n\n${ticket.description}`;
}

/**
 * Builds the text the indexer embeds for a wiki page.
 * @param page - Title and content of the page.
 * @returns The title as the first paragraph, then the content.
 * @remarks
 * The SQL of {@link SearchSourceRepository.listSourceStates} hashes the same
 * concatenation; both must change together.
 */
export function wikiPageSearchText(page: WikiPageSearchSource): string {
  return `${page.title}\n\n${page.content}`;
}

function readState(
  sourceType: SearchSourceState["sourceType"],
): (row: readonly DatabaseValue[]) => SearchSourceState {
  return (row) => ({
    sourceType,
    sourceId: readTextColumn(row, 0, "id"),
    contentHash: readTextColumn(row, 1, "content_hash"),
  });
}

/**
 * Reads the tickets, wiki pages and released ticket assets the local search
 * indexer embeds.
 * @remarks
 * The indexer runs without a person, so nothing here checks access; the
 * search filters by the reader's visibility before ranking.
 */
export class SearchSourceRepository {
  private readonly database: Database;

  /**
   * Creates the repository.
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Lists every searchable source with the hash of its current content.
   * @returns Tickets including archived ones, wiki pages outside the trash
   * that are no templates, and released ticket assets.
   */
  public async listSourceStates(): Promise<SearchSourceState[]> {
    const tickets = await this.database.query(`
      SELECT
          id,
          encode(sha256(convert_to("key" || ': ' || title || E'\\n\\n' || description, 'UTF8')), 'hex') AS content_hash
      FROM work_items
      ORDER BY id;
    `);
    const pages = await this.database.query(`
      SELECT
          id,
          encode(sha256(convert_to(title || E'\\n\\n' || "content", 'UTF8')), 'hex') AS content_hash
      FROM wiki_pages
      WHERE deleted_at IS NULL
          AND is_template = 0
      ORDER BY id;
    `);
    const assets = await this.database.query(`
      SELECT
          attachment.id,
          attachment.checksum AS content_hash
      FROM work_item_attachments AS attachment
      INNER JOIN ticket_asset_search_releases AS release
          ON release.attachment_id = attachment.id
      ORDER BY attachment.id;
    `);
    return [
      ...tickets.map(readState("ticket")),
      ...pages.map(readState("wiki_page")),
      ...assets.map(readState("ticket_asset")),
    ];
  }

  /**
   * Reads the text of a ticket.
   * @param id - Ticket identifier.
   * @returns The ticket, or `null` when it was deleted meanwhile.
   */
  public async readTicket(id: string): Promise<TicketSearchSource | null> {
    const [row] = await this.database.query(
      `
        SELECT
            id,
            "key",
            title,
            description
        FROM work_items
        WHERE id = $id;
      `,
      { id },
    );
    if (!row) return null;
    return {
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 1, "key"),
      title: readTextColumn(row, 2, "title"),
      description: readTextColumn(row, 3, "description"),
    };
  }

  /**
   * Reads the text and revision of a wiki page.
   * @param id - Page identifier.
   * @returns The page, or `null` when it is gone, in the trash or a template.
   */
  public async readWikiPage(id: string): Promise<WikiPageSearchSource | null> {
    const [row] = await this.database.query(
      `
        SELECT
            id,
            title,
            "content",
            revision
        FROM wiki_pages
        WHERE id = $id
            AND deleted_at IS NULL
            AND is_template = 0;
      `,
      { id },
    );
    if (!row) return null;
    return {
      id: readTextColumn(row, 0, "id"),
      title: readTextColumn(row, 1, "title"),
      content: readTextColumn(row, 2, "content"),
      revision: readCountColumn(row, 3, "revision"),
    };
  }

  /**
   * Reads a released ticket asset.
   * @param id - Attachment identifier.
   * @returns The asset, or `null` when it is gone or no longer released.
   */
  public async readReleasedAsset(
    id: string,
  ): Promise<ReleasedTicketAsset | null> {
    const [row] = await this.database.query(
      `
        SELECT
            attachment.id,
            attachment.file_name,
            attachment.content_type,
            attachment.checksum
        FROM work_item_attachments AS attachment
        INNER JOIN ticket_asset_search_releases AS release
            ON release.attachment_id = attachment.id
        WHERE attachment.id = $id;
      `,
      { id },
    );
    if (!row) return null;
    return {
      id: readTextColumn(row, 0, "id"),
      fileName: readTextColumn(row, 1, "file_name"),
      contentType: readTextColumn(row, 2, "content_type"),
      checksum: readTextColumn(row, 3, "checksum"),
    };
  }
}
