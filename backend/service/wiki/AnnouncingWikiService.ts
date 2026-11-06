import { WikiService } from "@/backend/service/WikiService";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { TaskEventSink } from "@/backend/service/AnnouncingTaskService";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";

type Method<Name extends keyof WikiService> = WikiService[Name] extends (
  ...input: infer Input
) => infer Output
  ? { readonly input: Input; readonly output: Output }
  : never;

/**
 * Calls whose event needs nothing read before the change: they take the writer
 * at their first write, so receiving an upload or checking access does not hold it.
 */
const OPENS_AT_FIRST_WRITE = { opensAtFirstWrite: true } as const;

/** The event of one page, none when the page is unknown. */
function pageEvents(type: PagesEvent["type"], id: string | null): PagesEvent[] {
  return id === null ? [] : [{ type, id }];
}

/**
 * The wiki service of the interface, which announces every page change it commits.
 *
 * @remarks
 * Agents announce their own wiki changes through the same publisher. An
 * announcement follows the stored change and names only the page; a call that
 * throws announces nothing. Comment and attachment changes name the page they
 * belong to, read before the change. Removing a page from the trash for good,
 * by hand or by the maintenance after its retention time, announces
 * `wiki.page.purged`. Personal state such as favorites, the
 * expanded tree and the feed is no page change and announces nothing. Discord
 * follows no wiki event, so its notifications stay as they were. Each call
 * runs as one transaction through the publisher, which stores the event with
 * the change and announces only a call that changed a row; a comment's or
 * attachment's page is read inside that transaction.
 */
export class AnnouncingWikiService extends WikiService {
  private readonly events: TaskEventSink;
  private readonly repository: WikiRepository;

  /**
   * Creates the announcing wiki service.
   *
   * @param wikiRepository - Wiki persistence boundary.
   * @param access - The services deciding project access and capabilities.
   * @param fileStore - Keeps attached files on the disk.
   * @param events - Receiver of the announcements.
   */
  public constructor(
    wikiRepository: WikiRepository,
    access: {
      readonly projectService: ProjectService;
      readonly permissionService: PermissionService;
    },
    fileStore: WikiFileStore,
    events: TaskEventSink,
  ) {
    super(
      wikiRepository,
      access.projectService,
      access.permissionService,
      fileStore,
    );
    this.events = events;
    this.repository = wikiRepository;
  }

  /** Creates a page and announces `wiki.page.created`. */
  public override async create(
    ...input: Method<"create">["input"]
  ): Promise<Awaited<Method<"create">["output"]>> {
    return this.events.announce(
      () => super.create(...input),
      (page): PagesEvent[] => [{ type: "wiki.page.created", id: page.id }],
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Saves a page, the draft save included, and announces `wiki.page.updated`. */
  public override async update(
    ...input: Method<"update">["input"]
  ): Promise<Awaited<Method<"update">["output"]>> {
    return this.announced("wiki.page.updated", input[1], () =>
      super.update(...input),
    );
  }

  /** Duplicates a page and announces the copy as `wiki.page.created`. */
  public override async duplicate(
    ...input: Method<"duplicate">["input"]
  ): Promise<Awaited<Method<"duplicate">["output"]>> {
    return this.events.announce(
      () => super.duplicate(...input),
      (page): PagesEvent[] => [{ type: "wiki.page.created", id: page.id }],
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Replaces the anchors and announces `wiki.page.updated`. */
  public override async setAnchors(
    ...input: Method<"setAnchors">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.setAnchors(...input),
    );
  }

  /** Sets or removes the cover and announces `wiki.page.updated`. */
  public override async setCover(
    ...input: Method<"setCover">["input"]
  ): Promise<Awaited<Method<"setCover">["output"]>> {
    return this.announced("wiki.page.updated", input[1], () =>
      super.setCover(...input),
    );
  }

  /** Sets the review date and announces `wiki.page.updated`. */
  public override async setCurrentUntil(
    ...input: Method<"setCurrentUntil">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.setCurrentUntil(...input),
    );
  }

  /** Changes the owner and announces `wiki.page.updated`. */
  public override async setOwner(
    ...input: Method<"setOwner">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.setOwner(...input),
    );
  }

  /** Moves a page and announces `wiki.page.updated`. */
  public override async move(...input: Method<"move">["input"]): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.move(...input),
    );
  }

  /** Moves a page to the trash and announces `wiki.page.updated`. */
  public override async delete(
    ...input: Method<"delete">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.delete(...input),
    );
  }

  /** Restores a page from the trash and announces `wiki.page.updated`. */
  public override async restore(
    ...input: Method<"restore">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.restore(...input),
    );
  }

  /** Moves a private page of somebody else to the trash and announces `wiki.page.updated`. */
  public override async deletePrivateAsAdministrator(
    ...input: Method<"deletePrivateAsAdministrator">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.updated", input[1], () =>
      super.deletePrivateAsAdministrator(...input),
    );
  }

  /** Restores a version and announces `wiki.page.updated`. */
  public override async restoreVersion(
    ...input: Method<"restoreVersion">["input"]
  ): Promise<Awaited<Method<"restoreVersion">["output"]>> {
    return this.announced("wiki.page.updated", input[1], () =>
      super.restoreVersion(...input),
    );
  }

  /** Removes a page from the trash for good and announces `wiki.page.purged`. */
  public override async purge(
    ...input: Method<"purge">["input"]
  ): Promise<void> {
    await this.announced("wiki.page.purged", input[1], () =>
      super.purge(...input),
    );
  }

  /** Runs the maintenance and announces each trash root it removed as `wiki.page.purged`. */
  public override async runMaintenance(): Promise<readonly string[]> {
    return this.events.announce(
      () => super.runMaintenance(),
      (purged) =>
        purged.map((id): PagesEvent => ({ type: "wiki.page.purged", id })),
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Adds a comment and announces `wiki.comments.changed` for its page. */
  public override async addComment(
    ...input: Method<"addComment">["input"]
  ): Promise<Awaited<Method<"addComment">["output"]>> {
    return this.announced("wiki.comments.changed", input[1], () =>
      super.addComment(...input),
    );
  }

  /** Edits a comment and announces `wiki.comments.changed` for its page. */
  public override async editComment(
    ...input: Method<"editComment">["input"]
  ): Promise<void> {
    // The page is read in the transaction of the change, so it is the page that changed.
    await this.events.announce(
      async () => {
        const pageId = await this.pageOfComment(input[1]);
        await super.editComment(...input);
        return pageId;
      },
      (pageId) => pageEvents("wiki.comments.changed", pageId),
    );
  }

  /** Removes a comment and announces `wiki.comments.changed` for its page. */
  public override async removeComment(
    ...input: Method<"removeComment">["input"]
  ): Promise<void> {
    // The page is read in the transaction of the change, so it is the page that changed.
    await this.events.announce(
      async () => {
        const pageId = await this.pageOfComment(input[1]);
        await super.removeComment(...input);
        return pageId;
      },
      (pageId) => pageEvents("wiki.comments.changed", pageId),
    );
  }

  /** Resolves a comment and announces `wiki.comments.changed` for its page. */
  public override async resolveComment(
    ...input: Method<"resolveComment">["input"]
  ): Promise<void> {
    // The page is read in the transaction of the change, so it is the page that changed.
    await this.events.announce(
      async () => {
        const pageId = await this.pageOfComment(input[1]);
        await super.resolveComment(...input);
        return pageId;
      },
      (pageId) => pageEvents("wiki.comments.changed", pageId),
    );
  }

  /** Attaches a file and announces `wiki.page.updated`. */
  public override async uploadAttachment(
    ...input: Method<"uploadAttachment">["input"]
  ): Promise<Awaited<Method<"uploadAttachment">["output"]>> {
    return this.announced("wiki.page.updated", input[1], () =>
      super.uploadAttachment(...input),
    );
  }

  /** Removes an attachment and announces `wiki.page.updated` for its page. */
  public override async removeAttachment(
    ...input: Method<"removeAttachment">["input"]
  ): Promise<void> {
    // The page is read in the transaction of the removal, so it is the page that changed.
    await this.events.announce(
      async () => {
        const stored = await this.repository.attachments.find(input[1]);
        await super.removeAttachment(...input);
        return stored?.pageId ?? null;
      },
      (pageId) => pageEvents("wiki.page.updated", pageId),
    );
  }

  /** The page of a comment; it fails the call when it cannot be read. */
  private async pageOfComment(id: string): Promise<string | null> {
    return (await this.repository.comments.find(id))?.pageId ?? null;
  }

  /** Runs a page change and announces it when it changed a row. */
  private async announced<Result>(
    type: PagesEvent["type"],
    id: string | null,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.events.announce(
      work,
      () => pageEvents(type, id),
      OPENS_AT_FIRST_WRITE,
    );
  }
}
