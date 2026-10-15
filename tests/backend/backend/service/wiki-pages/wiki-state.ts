import type { NewProjectActivity } from "@/backend/database/repositories/ProjectRepository";
import type {
  StoredWikiAttachment,
  StoredWikiComment,
  WikiPageRecord,
  WikiVersion,
} from "@/backend/database/repositories/WikiRepository";
import type { WikiLinkTargets } from "@/backend/service/wiki/WikiLinks";
import type {
  WikiAnchor,
  WikiSettings,
  WikiVisibilityScope,
} from "@/definition/Wiki";

/** A page as the in-memory wiki keeps it, with its trash facts. */
export interface PageRow {
  page: WikiPageRecord;
  position: number;
  deletedAt: string | null;
  deletedRootId: string | null;
  deletedBy: string | null;
}

/** Where an anchor target belongs; a missing target hides the page. */
export interface TargetFacts {
  readonly projectId: string | null;
  readonly departmentId: string | null;
}

/** An account the lookups know. */
export interface KnownUser {
  readonly username: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

/** One stored version of a page. */
export interface VersionRow extends WikiVersion {
  readonly pageId: string;
}

/** What `mentions.replace` was last asked to store for a text. */
export interface MentionRow {
  readonly pageId: string;
  readonly commentId: string;
  readonly userIds: readonly string[];
}

/** Everything a transaction can roll back. */
interface WikiData {
  pages: Map<string, PageRow>;
  anchors: Map<string, WikiAnchor[]>;
  comments: Map<string, StoredWikiComment>;
  attachments: Map<string, StoredWikiAttachment>;
  versions: VersionRow[];
  mentions: MentionRow[];
  links: Map<string, WikiLinkTargets>;
  activity: NewProjectActivity[];
  settings: WikiSettings | null;
  nextNumber: number;
}

function emptyData(): WikiData {
  return {
    activity: [],
    anchors: new Map(),
    attachments: new Map(),
    comments: new Map(),
    links: new Map(),
    mentions: [],
    nextNumber: 1,
    pages: new Map(),
    settings: null,
    versions: [],
  };
}

/** Rows that are cloned and restored when a transaction fails. */
export class WikiState {
  /** The rows a transaction can roll back. */
  public data: WikiData = emptyData();
  /** Anchor targets by `kind:id`. */
  public readonly targets = new Map<string, TargetFacts>();
  /** Accounts by identifier. */
  public readonly users = new Map<string, KnownUser>();
  /** Trash roots the retention time has expired for. */
  public expiredRoots: string[] = [];
  /** Arguments of every `versions.prune` call. */
  public readonly prunes: { retentionDays: number; keepLast: number }[] = [];
  /** Number of started transactions, to prove that work ran inside one. */
  public transactions = 0;
  /** Number of transactions that were rolled back. */
  public rollbacks = 0;

  /** The next number for identifiers such as `comment-3`. */
  public next(): number {
    const number = this.data.nextNumber;
    this.data.nextNumber += 1;
    return number;
  }

  /** Runs work and puts every row back when it throws. */
  public async transaction<Result>(
    work: () => Promise<Result>,
  ): Promise<Result> {
    const before = structuredClone(this.data);
    this.transactions += 1;
    try {
      return await work();
    } catch (error: unknown) {
      this.data = before;
      this.rollbacks += 1;
      throw error;
    }
  }
}

function satisfiesAnchor(
  state: WikiState,
  scope: WikiVisibilityScope,
  page: WikiPageRecord,
  anchor: WikiAnchor,
): boolean {
  const target = state.targets.get(`${anchor.kind}:${anchor.targetId}`);
  if (target === undefined) {
    // A vanished target hides the page from everybody but owner and admins.
    return scope.isAdmin || page.ownerId === scope.userId;
  }
  if (anchor.kind === "department") {
    return scope.isAdmin || scope.departmentIds.includes(anchor.targetId);
  }
  const readsProject =
    target.projectId !== null && scope.projectIds.includes(target.projectId);
  if (anchor.kind === "milestone") return readsProject;
  return (
    readsProject &&
    (scope.isAdmin ||
      target.departmentId === null ||
      scope.departmentIds.includes(target.departmentId))
  );
}

function isOwnVisibility(
  state: WikiState,
  scope: WikiVisibilityScope,
  row: PageRow,
  includeDeleted: boolean,
): boolean {
  const { page } = row;
  if (!includeDeleted && row.deletedAt !== null) return false;
  const isScopeVisible =
    page.scope === "instance" ||
    (page.scope === "project" &&
      page.projectId !== null &&
      scope.projectIds.includes(page.projectId)) ||
    (page.scope === "private" && page.ownerId === scope.userId);
  return (
    isScopeVisible &&
    (state.data.anchors.get(page.id) ?? []).every((anchor) =>
      satisfiesAnchor(state, scope, page, anchor),
    )
  );
}

/**
 * Applies the visibility rule of the wiki: scope, anchors and every ancestor.
 *
 * @param state - The rows to read.
 * @param scope - What the viewer may see.
 * @param id - Page identifier.
 * @param includeDeleted - Whether pages in the trash count.
 * @returns The row, or `null` when it is missing or hidden.
 */
export function visibleRow(
  state: WikiState,
  scope: WikiVisibilityScope,
  id: string,
  includeDeleted = false,
): PageRow | null {
  let current = state.data.pages.get(id);
  const row = current ?? null;
  while (current !== undefined) {
    if (!isOwnVisibility(state, scope, current, includeDeleted)) return null;
    current =
      current.page.parentId === null
        ? undefined
        : state.data.pages.get(current.page.parentId);
  }
  return row;
}

/** Ids of the page and everything below it, the page first. */
export function subtreeOf(state: WikiState, id: string): string[] {
  const result = [id];
  for (const current of result) {
    for (const [childId, row] of state.data.pages) {
      if (row.page.parentId === current) result.push(childId);
    }
  }
  return result;
}
