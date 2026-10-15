import { vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { WikiService } from "@/backend/service/WikiService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiAttachmentService } from "@/backend/service/wiki/WikiAttachmentService";
import { WikiCommentService } from "@/backend/service/wiki/WikiCommentService";
import { WikiCoverService } from "@/backend/service/wiki/WikiCoverService";
import { WikiMoveService } from "@/backend/service/wiki/WikiMoveService";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";
import { WikiSettingsService } from "@/backend/service/wiki/WikiSettingsService";
import { WikiTrashService } from "@/backend/service/wiki/WikiTrashService";
import { CAPABILITY } from "@/definition/Authorization";
import { ROLE } from "@/definition/Role";

import { MemoryWikiFiles } from "./memory-wiki-files";
import { installContentFakes } from "./wiki-content-fakes";
import { installPageFakes, WIKI_NOW } from "./wiki-page-fakes";
import { installReadingFakes, ReadingData } from "./wiki-reading-fakes";
import { WikiState } from "./wiki-state";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  StoredWikiAttachment,
  StoredWikiComment,
  WikiPageRecord,
} from "@/backend/database/repositories/WikiRepository";
import type { AccountAccess, Capability } from "@/definition/Authorization";
import type { User } from "@/definition/User";
import type { WikiAnchorKind } from "@/definition/Wiki";
import type { TargetFacts } from "./wiki-state";

/** What an account may do and see, independent of the legacy role. */
export interface WikiPersonOptions {
  readonly capabilities?: readonly Capability[];
  readonly isAdmin?: boolean;
  readonly isActive?: boolean;
  readonly departments?: readonly string[];
  readonly projects?: readonly string[];
}

/** Values of a seeded page; everything else has a neutral default. */
export interface WikiPageSeed {
  readonly id: string;
  readonly title?: string;
  readonly content?: string;
  readonly scope?: WikiPageRecord["scope"];
  readonly projectId?: string | null;
  readonly parentId?: string | null;
  readonly ownerId?: string;
  readonly isTemplate?: boolean;
  readonly position?: number;
  readonly icon?: string | null;
  readonly revision?: number;
}

function rejectDatabase(): never {
  throw new Error("Unexpected database access.");
}

/**
 * Real wiki services over in-memory repositories, files and accounts.
 *
 * @remarks
 * Only the repository classes are replaced; the services, the access
 * resolution, the permission policy and the validation are the production code.
 * A transaction restores every row when its work throws, as the database does.
 */
export class WikiWorld {
  /** Rows and transaction counters. */
  public readonly state = new WikiState();
  /** Canned answers and call records of the reading queries. */
  public readonly reading = new ReadingData();
  /** The wiki files; nothing reaches a disk. */
  public readonly files = new MemoryWikiFiles();
  /** The repository the services read through. */
  public readonly repository: WikiRepository;
  /** Resolves viewers from the people of this world. */
  public readonly access: WikiAccess;
  /** The permission policy over the people of this world. */
  public readonly permissions: PermissionService;
  /** The project service that supplies the visibility. */
  public readonly projects: ProjectService;
  private readonly people = new Map<string, WikiPersonOptions>();

  public constructor() {
    installPageFakes(this.state);
    installContentFakes(this.state);
    installReadingFakes(this.reading);
    const boundary: DatabaseTransaction = {
      execute: async () => rejectDatabase(),
      query: async () => rejectDatabase(),
    };
    const database = {
      ...boundary,
      transaction: async <Result>(
        work: (transaction: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => this.state.transaction(() => work(boundary)),
    };
    this.permissions = new PermissionService(async (userId) =>
      this.accountOf(userId),
    );
    this.projects = new ProjectService(
      new ProjectRepository(database),
      this.permissions,
    );
    vi.spyOn(ProjectService.prototype, "workItemVisibility").mockImplementation(
      async (actor) => {
        const person = this.people.get(actor.id);
        const isAdmin = person?.isAdmin === true;
        return {
          departmentIds: isAdmin ? null : [...(person?.departments ?? [])],
          projectIds: [...(person?.projects ?? [])],
        };
      },
    );
    this.repository = new WikiRepository(database);
    this.access = new WikiAccess(this.projects, this.permissions);
  }

  /** Adds an account and its user record; `write` is the default capability. */
  public addPerson(id: string, options: WikiPersonOptions = {}): User {
    this.people.set(id, options);
    const displayName = `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
    this.state.users.set(id, {
      displayName,
      isActive: options.isActive ?? true,
      username: id,
    });
    return this.actor(id);
  }

  /** The signed-in user object of a person. */
  public actor(id: string): User {
    const known = this.state.users.get(id);
    return {
      displayName: known?.displayName ?? id,
      id,
      isActive: known?.isActive ?? true,
      mustChangePassword: false,
      role: ROLE.EMPLOYEE,
      username: id,
    };
  }

  /** Registers a department, milestone or epic that anchors can point to. */
  public addTarget(
    kind: WikiAnchorKind,
    id: string,
    facts: Partial<TargetFacts> = {},
  ): void {
    this.state.targets.set(`${kind}:${id}`, {
      departmentId: facts.departmentId ?? null,
      projectId: facts.projectId ?? null,
    });
  }

  /** Puts a page into the wiki as it would be stored. */
  public addPage(seed: WikiPageSeed): WikiPageRecord {
    const ownerId = seed.ownerId ?? "owner";
    const page: WikiPageRecord = {
      content: seed.content ?? "",
      cover: null,
      createdAt: WIKI_NOW,
      currentUntil: null,
      icon: seed.icon ?? null,
      id: seed.id,
      isTemplate: seed.isTemplate ?? false,
      ownerId,
      ownerName: this.state.users.get(ownerId)?.displayName ?? ownerId,
      parentId: seed.parentId ?? null,
      projectId: seed.projectId ?? null,
      projectName: seed.projectId ?? null,
      revision: seed.revision ?? 1,
      scope: seed.scope ?? "instance",
      title: seed.title ?? `Page ${seed.id}`,
      updatedAt: WIKI_NOW,
      updatedByName: null,
    };
    this.state.data.pages.set(seed.id, {
      deletedAt: null,
      deletedBy: null,
      deletedRootId: null,
      page,
      position: seed.position ?? this.state.data.pages.size + 1,
    });
    return page;
  }

  /** Adds an anchor row without validation. */
  public addAnchor(
    pageId: string,
    kind: WikiAnchorKind,
    targetId: string,
  ): void {
    const anchors = this.state.data.anchors.get(pageId) ?? [];
    this.state.data.anchors.set(pageId, [...anchors, { kind, targetId }]);
  }

  /** Puts a comment into the wiki. */
  public addComment(
    comment: Partial<StoredWikiComment> & Pick<StoredWikiComment, "id">,
  ): StoredWikiComment {
    const stored: StoredWikiComment = {
      authorId: "writer",
      authorName: "Writer",
      body: "A comment",
      createdAt: WIKI_NOW,
      pageId: "page",
      parentId: null,
      quote: null,
      quotePrefix: null,
      quoteSuffix: null,
      resolvedAt: null,
      resolvedByName: null,
      updatedAt: WIKI_NOW,
      ...comment,
    };
    this.state.data.comments.set(stored.id, stored);
    return stored;
  }

  /** Puts an attachment row, and optionally its bytes, into the wiki. */
  public addAttachment(
    attachment: Partial<StoredWikiAttachment> &
      Pick<StoredWikiAttachment, "id">,
    bytes: Buffer = Buffer.from("bytes"),
  ): StoredWikiAttachment {
    const stored: StoredWikiAttachment = {
      checksum: "sum",
      contentType: "application/octet-stream",
      createdAt: WIKI_NOW,
      fileName: "file.bin",
      kind: "file",
      pageId: "page",
      size: bytes.length,
      storageName: `stored-${attachment.id}`,
      uploadedBy: "writer",
      uploadedByName: "Writer",
      ...attachment,
    };
    this.state.data.attachments.set(stored.id, stored);
    this.files.files.set(stored.storageName, bytes);
    return stored;
  }

  /** The stored record of a page; throws when it does not exist. */
  public page(id: string): WikiPageRecord {
    const row = this.state.data.pages.get(id);
    if (row === undefined) throw new Error(`No page ${id}.`);
    return row.page;
  }

  /** Whether the page row still exists, deleted or not. */
  public hasPage(id: string): boolean {
    return this.state.data.pages.has(id);
  }

  /** The anchors of a page as `kind:target` keys. */
  public anchorKeys(id: string): string[] {
    return (this.state.data.anchors.get(id) ?? []).map(
      ({ kind, targetId }) => `${kind}:${targetId}`,
    );
  }

  /** The page service of this world. */
  public pageService(): WikiPageService {
    return new WikiPageService(this.repository, this.access);
  }

  /** The move service of this world. */
  public moveService(): WikiMoveService {
    return new WikiMoveService(this.repository, this.access);
  }

  /** The trash service of this world. */
  public trashService(): WikiTrashService {
    return new WikiTrashService(this.repository, this.access);
  }

  /** The comment service of this world. */
  public commentService(): WikiCommentService {
    return new WikiCommentService(this.repository, this.access);
  }

  /** The cover service of this world. */
  public coverService(): WikiCoverService {
    return new WikiCoverService(this.repository, this.access);
  }

  /** The settings service of this world. */
  public settingsService(): WikiSettingsService {
    return new WikiSettingsService(this.repository, this.permissions);
  }

  /** The attachment service of this world, over the in-memory files. */
  public attachmentService(): WikiAttachmentService {
    return new WikiAttachmentService(
      this.repository,
      this.access,
      this.settingsService(),
      this.files,
    );
  }

  /** The facade that wires everything the way the application does. */
  public facade(): WikiService {
    return new WikiService(
      this.repository,
      this.projects,
      this.permissions,
      this.files,
    );
  }

  private accountOf(userId: string): AccountAccess {
    const person = this.people.get(userId);
    const known = this.state.users.get(userId);
    return {
      allDepartments: false,
      allProjects: false,
      departments: [...(person?.departments ?? [])],
      firstName: userId,
      hasHadDepartment: true,
      isActive: known?.isActive ?? false,
      isAdmin: person?.isAdmin ?? false,
      lastName: "Synthetic",
      managedDepartments: [],
      mode: person?.isAdmin === true ? "admin" : "role",
      role: {
        departmentBound: false,
        id: "synthetic-role",
        name: "Synthetic role",
        permissions: person?.capabilities ?? [CAPABILITY.WRITE],
        rank: 10,
      },
      userId,
    };
  }
}
