import { randomUUID } from "node:crypto";

import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { validateAnchors } from "./WikiAnchorValidator";
import { canManagePage } from "./WikiAccess";
import { extractWikiLinks } from "./WikiLinks";
import { syncMentions } from "./WikiMentions";
import { WikiPageReader } from "./WikiPageReader";
import { requireDepth, resolvePlacement } from "./WikiPlacementResolver";
import {
  normalizeDate,
  normalizeIcon,
  normalizeTitle,
  validateContent,
} from "./WikiValidation";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { WikiPageRecord } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import { WIKI_SCOPE } from "@/definition/Wiki";

import type { WikiAnchor, WikiPage, WikiScope } from "@/definition/Wiki";
import type { WikiAccess, WikiViewer } from "./WikiAccess";

/** Minutes within which saves by one author refresh a single version. */
const VERSION_COALESCE_MINUTES = 10;

/** Values of a page to create. */
export interface CreateWikiPageInput {
  readonly title: string;
  /** Page above, or `null` for a root page. */
  readonly parentId: string | null;
  /** Scope of a root page. */
  readonly scope: WikiScope | null;
  readonly projectId: string | null;
  readonly content: string;
  readonly icon: string | null;
  readonly anchors: readonly WikiAnchor[];
  /** Copy text and icon of this template instead of `content`. */
  readonly templateId: string | null;
  readonly isTemplate: boolean;
}

/** Values of a save. */
export interface UpdateWikiPageInput {
  readonly title: string;
  readonly content: string;
  readonly icon: string | null;
  /** Revision the editor started from; a mismatch is a conflict. */
  readonly expectedRevision: number;
}

/** How a page is copied. */
export interface DuplicateWikiPageInput {
  readonly title: string;
  readonly withChildren: boolean;
  readonly isTemplate: boolean;
}

/** A change to title, text and icon, and how a version records it. */
interface PageChange {
  readonly title: string;
  readonly content: string;
  readonly icon: string | null;
  /** Minutes within which a save refreshes the newest version; 0 adds one. */
  readonly coalesceMinutes: number;
}

/** Creates and changes the content and metadata of pages. */
export class WikiPageService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   */
  public constructor(repository: WikiRepository, access: WikiAccess) {
    this.repository = repository;
    this.access = access;
  }

  /**
   * Creates a page.
   *
   * @param actor - The signed-in user; they become owner and author.
   * @param input - Values of the page.
   * @returns The new page.
   * @throws {WikiAccessDeniedError} Without the capability "write".
   * @throws {WikiValidationError} For an invalid title, text, place or anchor.
   */
  public async create(
    actor: User,
    input: CreateWikiPageInput,
  ): Promise<WikiPage> {
    const viewer = await this.access.resolve(actor);
    requireWrite(viewer);
    const title = normalizeTitle(input.title);

    return this.repository.transaction(async (repository) => {
      const reader = new WikiPageReader(repository);
      const template = await this.readTemplate(repository, viewer, input);
      const content = validateContent(template?.content ?? input.content);
      const icon = normalizeIcon(template?.icon ?? input.icon);
      const resolved = await resolvePlacement(repository, viewer, input);

      requireDepth(resolved.level, 0);

      const anchors = await validateAnchors(
        repository,
        viewer.scope,
        resolved.placement,
        input.anchors,
      );
      const id = randomUUID();

      await repository.writes.insert(
        {
          authorId: actor.id,
          content,
          icon,
          id,
          isTemplate: input.isTemplate,
          ownerId: actor.id,
          parentId: resolved.placement.parentId,
          projectId: resolved.placement.projectId,
          scope: resolved.placement.scope,
          title,
        },
        await repository.writes.nextPosition(resolved.placement, actor.id),
      );
      await repository.anchors.replaceAnchors(id, anchors);
      await repository.versions.save(
        { authorId: actor.id, content, pageId: id, revision: 1, title },
        0,
      );
      await repository.links.replace(id, extractWikiLinks(content));
      await this.recordMentions(repository, {
        authorId: actor.id,
        content,
        id,
        isPrivate: resolved.placement.scope === WIKI_SCOPE.PRIVATE,
      });

      return reader.assemble(await reader.require(viewer.scope, id));
    });
  }

  /**
   * Saves the text and title of a page.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param input - New values and the revision they are based on.
   * @returns The page as saved.
   * @throws {WikiConflictError} When somebody saved in the meantime.
   * @throws {WikiPageNotFoundError} When the page is missing or hidden.
   */
  public async update(
    actor: User,
    id: string,
    input: UpdateWikiPageInput,
  ): Promise<WikiPage> {
    const viewer = await this.access.resolve(actor);
    requireWrite(viewer);
    const edit = {
      content: validateContent(input.content),
      icon: normalizeIcon(input.icon),
      title: normalizeTitle(input.title),
    };

    return this.repository.transaction(async (repository) => {
      const reader = new WikiPageReader(repository);
      const current = await reader.require(viewer.scope, id);

      if (current.revision !== input.expectedRevision) {
        throw new WikiConflictError(await reader.assemble(current));
      }

      return this.applyEdit(repository, viewer, current, {
        ...edit,
        coalesceMinutes: VERSION_COALESCE_MINUTES,
      });
    });
  }

  /**
   * Replaces a page with the text of an earlier version.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param versionId - Version to take the text from.
   * @returns The page, with a new version on top.
   * @throws {WikiValidationError} When the version does not exist.
   */
  public async restoreVersion(
    actor: User,
    id: string,
    versionId: string,
  ): Promise<WikiPage> {
    const viewer = await this.access.resolve(actor);
    requireWrite(viewer);

    return this.repository.transaction(async (repository) => {
      const current = await new WikiPageReader(repository).require(
        viewer.scope,
        id,
      );
      const version = await repository.versions.find(id, versionId);

      if (!version) {
        throw new WikiValidationError("versionMissing");
      }

      return this.applyEdit(repository, viewer, current, {
        coalesceMinutes: 0,
        content: version.content,
        icon: current.icon,
        title: version.title,
      });
    });
  }

  /**
   * Replaces the anchors of a page.
   *
   * @param actor - The signed-in user; they must manage the page.
   * @param id - Page identifier.
   * @param anchors - The anchors the page has afterwards.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   * @throws {WikiValidationError} For an invalid anchor.
   */
  public async setAnchors(
    actor: User,
    id: string,
    anchors: readonly WikiAnchor[],
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const page = await this.requireManaged(repository, viewer, id);
      const valid = await validateAnchors(
        repository,
        viewer.scope,
        page,
        anchors,
      );

      await repository.anchors.replaceAnchors(id, valid);
    });
  }

  /**
   * Sets or clears the date until which a page counts as up to date.
   *
   * @param actor - The signed-in user; they must manage the page.
   * @param id - Page identifier.
   * @param currentUntil - Date as `YYYY-MM-DD`, or `null`.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   * @throws {WikiValidationError} For an invalid date.
   */
  public async setCurrentUntil(
    actor: User,
    id: string,
    currentUntil: string | null,
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);
    const date = normalizeDate(currentUntil);

    await this.repository.transaction(async (repository) => {
      await this.requireManaged(repository, viewer, id);
      await repository.writes.setCurrentUntil(id, date);
    });
  }

  /**
   * Hands a page over to another owner.
   *
   * @param actor - The signed-in user; they must manage the page.
   * @param id - Page identifier.
   * @param ownerId - The new owner, an active account.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   * @throws {WikiValidationError} For a private page or an unknown account.
   */
  public async setOwner(
    actor: User,
    id: string,
    ownerId: string,
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const page = await this.requireManaged(repository, viewer, id);

      if (
        page.scope === WIKI_SCOPE.PRIVATE ||
        !(await repository.lookups.isActiveUser(ownerId))
      ) {
        throw new WikiValidationError("invalidScope");
      }

      await repository.writes.setOwner(id, ownerId);
    });
  }

  /**
   * Copies a page, optionally with the pages below it.
   *
   * @param actor - The signed-in user; they own the copies.
   * @param id - Page to copy.
   * @param input - Title of the copy and whether children are copied.
   * @returns The copy.
   * @throws {WikiAccessDeniedError} Without the capability "write".
   *
   * @remarks
   * Only pages the actor can see are copied. The copy is appended to the
   * siblings of the original and starts a fresh history.
   */
  public async duplicate(
    actor: User,
    id: string,
    input: DuplicateWikiPageInput,
  ): Promise<WikiPage> {
    const viewer = await this.access.resolve(actor);
    requireWrite(viewer);
    const title = normalizeTitle(input.title);

    return this.repository.transaction(async (repository) => {
      const reader = new WikiPageReader(repository);
      const source = await reader.require(viewer.scope, id);
      const copyId = await this.copyTree(repository, viewer, source, {
        ...input,
        title,
      });

      return reader.assemble(await reader.require(viewer.scope, copyId));
    });
  }

  private async copyTree(
    repository: WikiRepository,
    viewer: WikiViewer,
    source: WikiPageRecord,
    input: DuplicateWikiPageInput,
  ): Promise<string> {
    const nodes = input.withChildren
      ? await repository.pages.listNodes(viewer.scope)
      : [];
    const childrenOf = new Map<string, string[]>();

    for (const node of nodes) {
      if (node.parentId !== null) {
        childrenOf.set(node.parentId, [
          ...(childrenOf.get(node.parentId) ?? []),
          node.id,
        ]);
      }
    }

    const copyRootId = randomUUID();
    const queue = [
      {
        copyId: copyRootId,
        parentCopyId: source.parentId,
        sourceId: source.id,
      },
    ];

    for (const entry of queue) {
      const page = await new WikiPageReader(repository).require(
        viewer.scope,
        entry.sourceId,
      );

      await this.copyPage(repository, viewer, page, {
        copyId: entry.copyId,
        isRoot: entry.copyId === copyRootId,
        parentId: entry.parentCopyId,
        title: input.title,
        isTemplate: input.isTemplate,
      });

      for (const childId of childrenOf.get(entry.sourceId) ?? []) {
        queue.push({
          copyId: randomUUID(),
          parentCopyId: entry.copyId,
          sourceId: childId,
        });
      }
    }

    return copyRootId;
  }

  private async copyPage(
    repository: WikiRepository,
    viewer: WikiViewer,
    page: WikiPageRecord,
    target: {
      readonly copyId: string;
      readonly isRoot: boolean;
      readonly parentId: string | null;
      readonly title: string;
      readonly isTemplate: boolean;
    },
  ): Promise<void> {
    const placement = {
      parentId: target.parentId,
      projectId: page.projectId,
      scope: page.scope,
    };
    const title = target.isRoot ? target.title : page.title;

    await repository.writes.insert(
      {
        authorId: viewer.user.id,
        content: page.content,
        icon: page.icon,
        id: target.copyId,
        isTemplate: target.isRoot ? target.isTemplate : page.isTemplate,
        ownerId: viewer.user.id,
        parentId: target.parentId,
        projectId: page.projectId,
        scope: page.scope,
        title,
      },
      await repository.writes.nextPosition(placement, viewer.user.id),
    );
    await repository.anchors.replaceAnchors(
      target.copyId,
      (await repository.anchors.findAnchors(page.id))
        .filter((anchor) => anchor.label !== null)
        .map(({ kind, targetId }) => ({ kind, targetId })),
    );
    await repository.versions.save(
      {
        authorId: viewer.user.id,
        content: page.content,
        pageId: target.copyId,
        revision: 1,
        title,
      },
      0,
    );
    await repository.links.replace(
      target.copyId,
      extractWikiLinks(page.content),
    );
  }

  private async applyEdit(
    repository: WikiRepository,
    viewer: WikiViewer,
    current: WikiPageRecord,
    change: PageChange,
  ): Promise<WikiPage> {
    const { coalesceMinutes, ...edit } = change;
    const reader = new WikiPageReader(repository);

    if (
      edit.title === current.title &&
      edit.content === current.content &&
      edit.icon === current.icon
    ) {
      return reader.assemble(current);
    }

    const revision = await repository.writes.saveEdit(current.id, {
      ...edit,
      editorId: viewer.user.id,
    });

    await repository.versions.save(
      {
        authorId: viewer.user.id,
        content: edit.content,
        pageId: current.id,
        revision,
        title: edit.title,
      },
      coalesceMinutes,
    );
    await repository.links.replace(current.id, extractWikiLinks(edit.content));
    await this.recordMentions(repository, {
      authorId: viewer.user.id,
      content: edit.content,
      id: current.id,
      isPrivate: current.scope === WIKI_SCOPE.PRIVATE,
    });

    return reader.assemble(await reader.require(viewer.scope, current.id));
  }

  private async recordMentions(
    repository: WikiRepository,
    page: {
      readonly id: string;
      readonly content: string;
      readonly authorId: string;
      readonly isPrivate: boolean;
    },
  ): Promise<void> {
    if (!page.isPrivate) {
      await syncMentions(repository, {
        authorId: page.authorId,
        commentId: "",
        pageId: page.id,
        text: page.content,
      });
    }
  }

  private async readTemplate(
    repository: WikiRepository,
    viewer: WikiViewer,
    input: CreateWikiPageInput,
  ): Promise<WikiPageRecord | null> {
    if (input.templateId === null) {
      return null;
    }

    const template = await repository.pages.findVisible(
      viewer.scope,
      input.templateId,
    );

    if (!template?.isTemplate) {
      throw new WikiPageNotFoundError();
    }

    return template;
  }

  private async requireManaged(
    repository: WikiRepository,
    viewer: WikiViewer,
    id: string,
  ): Promise<WikiPageRecord> {
    const page = await new WikiPageReader(repository).require(viewer.scope, id);

    if (!canManagePage(viewer, page)) {
      throw new WikiAccessDeniedError();
    }

    return page;
  }
}

function requireWrite(viewer: WikiViewer): void {
  if (!viewer.canWrite) {
    throw new WikiAccessDeniedError();
  }
}
