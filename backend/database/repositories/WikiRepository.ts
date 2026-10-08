import { deleteWikiPages } from "./wiki/WikiPageDeletion";
import { WikiAnchorRepository } from "./wiki/WikiAnchorRepository";
import { WikiAttachmentRepository } from "./wiki/WikiAttachmentRepository";
import { WikiCommentRepository } from "./wiki/WikiCommentRepository";
import { WikiFeedRepository } from "./wiki/WikiFeedRepository";
import { WikiLinkRepository } from "./wiki/WikiLinkRepository";
import { WikiLookupRepository } from "./wiki/WikiLookupRepository";
import { WikiMentionRepository } from "./wiki/WikiMentionRepository";
import { WikiPageRepository } from "./wiki/WikiPageRepository";
import { WikiPageWriteRepository } from "./wiki/WikiPageWriteRepository";
import { WikiSearchRepository } from "./wiki/WikiSearchRepository";
import { WikiSettingsRepository } from "./wiki/WikiSettingsRepository";
import { WikiStateRepository } from "./wiki/WikiStateRepository";
import { WikiVersionRepository } from "./wiki/WikiVersionRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { WikiPageSelection } from "./wiki/WikiPageDeletion";

export type { WikiNodeRecord, WikiTrashEntry } from "./wiki/WikiPageRepository";
export type {
  NewWikiPage,
  WikiPageEdit,
  WikiPlacement,
} from "./wiki/WikiPageWriteRepository";
export type {
  NewWikiVersion,
  WikiVersion,
  WikiVersionSummary,
} from "./wiki/WikiVersionRepository";
export type {
  NewWikiComment,
  StoredWikiComment,
} from "./wiki/WikiCommentRepository";
export type {
  NewWikiAttachment,
  StoredWikiAttachment,
} from "./wiki/WikiAttachmentRepository";
export type { WikiPageRecord } from "./wiki/WikiPageRows";
export type {
  WikiSearchArea,
  WikiSearchFilters,
  WikiSearchSort,
} from "./wiki/WikiSearchRepository";
export type { WikiPageSelection } from "./wiki/WikiPageDeletion";

/** Supports both database-owned and already locked wiki transactions. */
type WikiDatabase = Pick<Database, "execute" | "query" | "transaction">;

/**
 * Establishes the persistence boundary for the wiki.
 *
 * @remarks
 * Coordinates the wiki aggregates and their shared transaction.
 */
export class WikiRepository {
  /** Reads of pages, their tree and their trash. */
  public readonly pages: WikiPageRepository;
  /** Changes to pages. */
  public readonly writes: WikiPageWriteRepository;
  /** Anchors that tie pages to departments, milestones and epics. */
  public readonly anchors: WikiAnchorRepository;
  /** Lookups of accounts and projects. */
  public readonly lookups: WikiLookupRepository;
  /** Comments below pages. */
  public readonly comments: WikiCommentRepository;
  /** The queries behind "For me". */
  public readonly feed: WikiFeedRepository;
  /** Who is mentioned in pages and comments. */
  public readonly mentions: WikiMentionRepository;
  /** Metadata of attached files. */
  public readonly attachments: WikiAttachmentRepository;
  /** Links between pages and to tickets. */
  public readonly links: WikiLinkRepository;
  /** Text search over visible pages. */
  public readonly search: WikiSearchRepository;
  /** Versions of pages. */
  public readonly versions: WikiVersionRepository;
  /** Settings of the wiki as a whole. */
  public readonly settings: WikiSettingsRepository;
  /** Favorites, recent pages and open branches of users. */
  public readonly state: WikiStateRepository;
  private readonly database: WikiDatabase;

  /**
   * Creates a wiki repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: WikiDatabase) {
    this.database = database;
    this.pages = new WikiPageRepository(database);
    this.writes = new WikiPageWriteRepository(database);
    this.anchors = new WikiAnchorRepository(database);
    this.lookups = new WikiLookupRepository(database);
    this.comments = new WikiCommentRepository(database);
    this.feed = new WikiFeedRepository(database);
    this.mentions = new WikiMentionRepository(database);
    this.attachments = new WikiAttachmentRepository(database);
    this.links = new WikiLinkRepository(database);
    this.search = new WikiSearchRepository(database);
    this.versions = new WikiVersionRepository(database);
    this.settings = new WikiSettingsRepository(database);
    this.state = new WikiStateRepository(database);
  }

  /**
   * Runs several wiki reads and writes atomically.
   *
   * @param work - Receives a repository bound to the transaction.
   * @returns Whatever `work` returns once the transaction committed.
   */
  public async transaction<Result>(
    work: (repository: WikiRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((transaction) =>
      work(
        new WikiRepository({
          execute: transaction.execute.bind(transaction),
          query: transaction.query.bind(transaction),
          transaction: async <Nested>(
            operation: (scope: DatabaseTransaction) => Promise<Nested>,
          ): Promise<Nested> => operation(transaction),
        }),
      ),
    );
  }

  /**
   * Deletes pages for good with everything that belongs to them.
   *
   * @param selection - The pages to delete.
   * @returns Storage names of the attachment files to remove from the disk.
   */
  public async deletePages(selection: WikiPageSelection): Promise<string[]> {
    return deleteWikiPages(this.database, selection);
  }
}
