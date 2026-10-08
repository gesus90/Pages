import { WikiAccess } from "./wiki/WikiAccess";
import { WikiAttachmentService } from "./wiki/WikiAttachmentService";
import { WikiCommentService } from "./wiki/WikiCommentService";
import { WikiFeedService } from "./wiki/WikiFeedService";
import { WikiChoiceService } from "./wiki/WikiChoiceService";
import { WikiMaintenanceService } from "./wiki/WikiMaintenanceService";
import { WikiMoveService } from "./wiki/WikiMoveService";
import { WikiPageService } from "./wiki/WikiPageService";
import { WikiReadService } from "./wiki/WikiReadService";
import { WikiSearchService } from "./wiki/WikiSearchService";
import { WikiSettingsService } from "./wiki/WikiSettingsService";
import { WikiTrashService } from "./wiki/WikiTrashService";
import { WikiVersionService } from "./wiki/WikiVersionService";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  WikiRepository,
  WikiTrashEntry,
  WikiVersion,
  WikiVersionSummary,
} from "@/backend/database/repositories/WikiRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { User } from "@/definition/User";
import type {
  WikiAnchor,
  WikiAnchorChoices,
  WikiAttachment,
  WikiBacklinks,
  WikiComment,
  WikiCommentThread,
  WikiFeedItem,
  WikiOwnerCandidate,
  WikiHome,
  WikiNavigation,
  WikiPage,
  WikiPrivatePlaceholder,
  WikiReference,
  WikiSearchResponse,
  WikiSettings,
  WikiVisibilityChange,
} from "@/definition/Wiki";
import type { MoveWikiPageInput } from "./wiki/WikiMoveService";
import type {
  CreateWikiPageInput,
  DuplicateWikiPageInput,
  UpdateWikiPageInput,
} from "./wiki/WikiPageService";
import type { WikiReadResult } from "./wiki/WikiReadService";
import type { CommentInput } from "./wiki/WikiCommentService";
import type { WikiSearchInput } from "./wiki/WikiSearchService";
import type {
  OpenedAttachment,
  UploadedFile,
} from "./wiki/WikiAttachmentService";

export type { MoveWikiPageInput } from "./wiki/WikiMoveService";
export type {
  CreateWikiPageInput,
  DuplicateWikiPageInput,
  UpdateWikiPageInput,
} from "./wiki/WikiPageService";
export type { WikiReadResult } from "./wiki/WikiReadService";
export type { CommentInput } from "./wiki/WikiCommentService";
export type { WikiSearchInput } from "./wiki/WikiSearchService";
export type {
  OpenedAttachment,
  UploadedFile,
} from "./wiki/WikiAttachmentService";

/**
 * Establishes the business-logic boundary for wiki pages.
 *
 * @remarks
 * A thin facade over one small service per aggregate. Every method resolves
 * the visibility of the acting account first, so no read or change reaches a
 * page the account does not see.
 */
export class WikiService {
  private readonly pages: WikiPageService;
  private readonly moves: WikiMoveService;
  private readonly trash: WikiTrashService;
  private readonly reads: WikiReadService;
  private readonly versions: WikiVersionService;
  private readonly settings: WikiSettingsService;
  private readonly maintenance: WikiMaintenanceService;
  private readonly choices: WikiChoiceService;
  private readonly searches: WikiSearchService;
  private readonly attachments: WikiAttachmentService;
  private readonly comments: WikiCommentService;
  private readonly feed: WikiFeedService;

  /**
   * Creates a wiki service.
   *
   * @param wikiRepository - Wiki persistence boundary.
   * @param projectService - Decides which projects an account reads.
   * @param permissionService - Decides the capabilities of an account.
   * @param fileStore - Keeps attached files on the disk.
   */
  public constructor(
    wikiRepository: WikiRepository,
    projectService: ProjectService,
    permissionService: PermissionService,
    fileStore: WikiFileStore,
  ) {
    const access = new WikiAccess(projectService, permissionService);

    this.pages = new WikiPageService(wikiRepository, access);
    this.choices = new WikiChoiceService(wikiRepository, access);
    this.searches = new WikiSearchService(wikiRepository, access);
    this.moves = new WikiMoveService(wikiRepository, access);
    this.trash = new WikiTrashService(wikiRepository, access);
    this.reads = new WikiReadService(wikiRepository, access, this.trash);
    this.versions = new WikiVersionService(wikiRepository, access);
    this.settings = new WikiSettingsService(wikiRepository, permissionService);
    this.comments = new WikiCommentService(wikiRepository, access);
    this.feed = new WikiFeedService(wikiRepository, access);
    this.attachments = new WikiAttachmentService(
      wikiRepository,
      access,
      this.settings,
      fileStore,
    );
    this.maintenance = new WikiMaintenanceService(
      this.settings,
      this.trash,
      this.versions,
      this.attachments,
    );
  }

  /** Opens a page, or the placeholder an administrator gets for a private one. */
  public async read(actor: User, id: string): Promise<WikiReadResult> {
    return this.reads.read(actor, id);
  }

  /** Builds the data of the left navigation. */
  public async navigation(actor: User): Promise<WikiNavigation> {
    return this.reads.navigation(actor);
  }

  /** Builds the lists of the start page. */
  public async home(actor: User): Promise<WikiHome> {
    return this.reads.home(actor);
  }

  /** Lists the templates the actor may use. */
  public async templates(
    actor: User,
  ): Promise<{ id: string; title: string; icon: string | null }[]> {
    return this.reads.templates(actor);
  }

  /** Marks or unmarks a favorite. */
  public async setFavorite(
    actor: User,
    id: string,
    isFavorite: boolean,
  ): Promise<void> {
    return this.reads.setFavorite(actor, id, isFavorite);
  }

  /** Opens or closes a branch of the tree. */
  public async setExpanded(
    actor: User,
    id: string,
    isExpanded: boolean,
  ): Promise<void> {
    return this.reads.setExpanded(actor, id, isExpanded);
  }

  /** Lists the anchors a page can get and the ones it has. */
  public async anchorChoices(
    actor: User,
    id: string,
  ): Promise<WikiAnchorChoices> {
    return this.choices.anchorChoices(actor, id);
  }

  /** Lists the accounts a page can be handed to. */
  public async ownerCandidates(actor: User): Promise<WikiOwnerCandidate[]> {
    return this.choices.ownerCandidates(actor);
  }

  /** Searches the titles and texts of the visible pages. */
  public async search(
    actor: User,
    input: WikiSearchInput,
  ): Promise<WikiSearchResponse> {
    return this.searches.search(actor, input);
  }

  /** Offers pages, tickets and people to link or mention. */
  public async references(
    actor: User,
    query: string,
  ): Promise<WikiReference[]> {
    return this.searches.references(actor, query);
  }

  /** Resolves the titles of pages that tickets and projects link to. */
  public async linkTitles(
    actor: User,
    ids: readonly string[],
  ): Promise<Record<string, string>> {
    return this.searches.linkTitles(actor, ids);
  }

  /** Finds where a page is mentioned. */
  public async backlinks(actor: User, id: string): Promise<WikiBacklinks> {
    return this.searches.backlinks(actor, id);
  }

  /** Creates a page. */
  public async create(
    actor: User,
    input: CreateWikiPageInput,
  ): Promise<WikiPage> {
    return this.pages.create(actor, input);
  }

  /** Saves the title and text of a page against a revision. */
  public async update(
    actor: User,
    id: string,
    input: UpdateWikiPageInput,
  ): Promise<WikiPage> {
    return this.pages.update(actor, id, input);
  }

  /** Copies a page, optionally with its subtree. */
  public async duplicate(
    actor: User,
    id: string,
    input: DuplicateWikiPageInput,
  ): Promise<WikiPage> {
    return this.pages.duplicate(actor, id, input);
  }

  /** Replaces the anchors of a page. */
  public async setAnchors(
    actor: User,
    id: string,
    anchors: readonly WikiAnchor[],
  ): Promise<void> {
    return this.pages.setAnchors(actor, id, anchors);
  }

  /** Sets or clears the date until which a page counts as up to date. */
  public async setCurrentUntil(
    actor: User,
    id: string,
    currentUntil: string | null,
  ): Promise<void> {
    return this.pages.setCurrentUntil(actor, id, currentUntil);
  }

  /** Hands a page over to another owner. */
  public async setOwner(
    actor: User,
    id: string,
    ownerId: string,
  ): Promise<void> {
    return this.pages.setOwner(actor, id, ownerId);
  }

  /** Moves a page with its subtree. */
  public async move(
    actor: User,
    id: string,
    input: MoveWikiPageInput,
  ): Promise<void> {
    return this.moves.move(actor, id, input);
  }

  /** Tells how a move would change who sees the page. */
  public async previewMove(
    actor: User,
    id: string,
    input: MoveWikiPageInput,
  ): Promise<WikiVisibilityChange> {
    return this.moves.preview(actor, id, input);
  }

  /** Moves a page and its subtree into the trash. */
  public async delete(actor: User, id: string): Promise<void> {
    return this.trash.delete(actor, id);
  }

  /** Lists the deleted pages the actor may restore. */
  public async listTrash(actor: User): Promise<WikiTrashEntry[]> {
    return this.trash.list(actor);
  }

  /** Brings a deleted page back. */
  public async restore(actor: User, id: string): Promise<void> {
    return this.trash.restore(actor, id);
  }

  /** Removes a page from the trash for good, with its attached files. */
  public async purge(actor: User, id: string): Promise<void> {
    await this.attachments.removeFiles(await this.trash.purge(actor, id));
  }

  /** Looks up the placeholder of a private page for an administrator. */
  public async findPlaceholder(
    actor: User,
    id: string,
  ): Promise<WikiPrivatePlaceholder | null> {
    return this.trash.findPlaceholder(actor, id);
  }

  /** Lists the private pages of one account as placeholders. */
  public async listPlaceholders(
    actor: User,
    ownerId: string,
  ): Promise<WikiPrivatePlaceholder[]> {
    return this.trash.listPlaceholders(actor, ownerId);
  }

  /** Counts the private pages of every account for administrators. */
  public async countPrivatePages(
    actor: User,
  ): Promise<ReadonlyMap<string, number>> {
    return this.trash.countPrivatePages(actor);
  }

  /** Lists the private pages of every account as placeholders. */
  public async listAllPlaceholders(
    actor: User,
  ): Promise<Record<string, WikiPrivatePlaceholder[]>> {
    return this.trash.listAllPlaceholders(actor);
  }

  /** Deletes a private page of somebody else into the owner's trash. */
  public async deletePrivateAsAdministrator(
    actor: User,
    id: string,
  ): Promise<void> {
    return this.trash.deletePrivateAsAdministrator(actor, id);
  }

  /** Lists the versions of a page. */
  public async listVersions(
    actor: User,
    id: string,
  ): Promise<WikiVersionSummary[]> {
    return this.versions.list(actor, id);
  }

  /** Reads one version for the preview. */
  public async getVersion(
    actor: User,
    id: string,
    versionId: string,
  ): Promise<WikiVersion> {
    return this.versions.get(actor, id, versionId);
  }

  /** Replaces a page with the text of an earlier version. */
  public async restoreVersion(
    actor: User,
    id: string,
    versionId: string,
  ): Promise<WikiPage> {
    return this.pages.restoreVersion(actor, id, versionId);
  }

  /** Returns the wiki settings that apply. */
  public async getSettings(): Promise<WikiSettings> {
    return this.settings.get();
  }

  /** Replaces the wiki settings. */
  public async updateSettings(
    actor: User,
    settings: WikiSettings,
  ): Promise<void> {
    return this.settings.update(actor, settings);
  }

  /** Removes expired trash, old versions and files nobody refers to. */
  public async runMaintenance(): Promise<void> {
    return this.maintenance.run();
  }

  /** Lists the comments of a page as threads. */
  public async listComments(
    actor: User,
    pageId: string,
  ): Promise<WikiCommentThread[]> {
    return this.comments.list(actor, pageId);
  }

  /** Adds a comment or a reply. */
  public async addComment(
    actor: User,
    pageId: string,
    input: CommentInput,
  ): Promise<WikiComment> {
    return this.comments.add(actor, pageId, input);
  }

  /** Changes the text of a comment. */
  public async editComment(
    actor: User,
    id: string,
    body: string,
  ): Promise<void> {
    return this.comments.edit(actor, id, body);
  }

  /** Deletes a comment with its replies. */
  public async removeComment(actor: User, id: string): Promise<void> {
    return this.comments.remove(actor, id);
  }

  /** Resolves a thread of comments, or opens it again. */
  public async resolveComment(
    actor: User,
    id: string,
    isResolved: boolean,
  ): Promise<void> {
    return this.comments.resolve(actor, id, isResolved);
  }

  /** Lists what concerns the person: the area "For me". */
  public async forMe(actor: User): Promise<WikiFeedItem[]> {
    return this.feed.forMe(actor);
  }

  /** Marks "For me" as read. */
  public async markFeedRead(actor: User): Promise<void> {
    return this.feed.markRead(actor);
  }

  /** Attaches an uploaded file to a page. */
  public async uploadAttachment(
    actor: User,
    pageId: string,
    file: UploadedFile,
  ): Promise<WikiAttachment> {
    return this.attachments.upload(actor, pageId, file);
  }

  /** Lists the attachments of a page. */
  public async listAttachments(
    actor: User,
    pageId: string,
  ): Promise<WikiAttachment[]> {
    return this.attachments.list(actor, pageId);
  }

  /** Opens an attachment for download. */
  public async openAttachment(
    actor: User,
    id: string,
  ): Promise<OpenedAttachment> {
    return this.attachments.open(actor, id);
  }

  /** Removes an attachment and its file. */
  public async removeAttachment(actor: User, id: string): Promise<void> {
    return this.attachments.remove(actor, id);
  }
}
