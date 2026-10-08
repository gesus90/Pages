/** Fixed limits of wiki texts, counted in Unicode characters (T4.3.9). */
export const WIKI_LIMITS = {
  titleLength: 200,
  contentLength: 200_000,
  commentLength: 5_000,
  treeDepth: 10,
  fileNameLength: 255,
  headingLength: 200,
} as const;

/** Where a page lives: for everyone, within one project, or for its owner. */
export const WIKI_SCOPE = {
  INSTANCE: "instance",
  PROJECT: "project",
  PRIVATE: "private",
} as const;

/** A scope of a wiki page. */
export type WikiScope = (typeof WIKI_SCOPE)[keyof typeof WIKI_SCOPE];

/** Narrows an external value to a wiki scope. */
export function isWikiScope(value: unknown): value is WikiScope {
  return (
    typeof value === "string" &&
    Object.values(WIKI_SCOPE).some((scope) => scope === value)
  );
}

/** What a page can be tied to besides its scope. */
export const WIKI_ANCHOR_KIND = {
  DEPARTMENT: "department",
  MILESTONE: "milestone",
  EPIC: "epic",
} as const;

/** The kind of a page anchor. */
export type WikiAnchorKind =
  (typeof WIKI_ANCHOR_KIND)[keyof typeof WIKI_ANCHOR_KIND];

/** Narrows an external value to an anchor kind. */
export function isWikiAnchorKind(value: unknown): value is WikiAnchorKind {
  return (
    typeof value === "string" &&
    Object.values(WIKI_ANCHOR_KIND).some((kind) => kind === value)
  );
}

/** A restriction of a page: it is visible only to who sees the target. */
export interface WikiAnchor {
  readonly kind: WikiAnchorKind;
  readonly targetId: string;
}

/** Where a page lives, without its position in the tree. */
export interface WikiPlacementScope {
  readonly scope: WikiScope;
  readonly projectId: string | null;
}

/** An anchor with the name of its target for display. */
export interface WikiAnchorTarget extends WikiAnchor {
  /** Name of the target; `null` once the target no longer exists. */
  readonly label: string | null;
}

/**
 * What decides whether an account sees a page. It is resolved on the server
 * for each request and never leaves it.
 */
export interface WikiVisibilityScope {
  readonly userId: string;
  /** True in the active admin mode, which sees every department. */
  readonly isAdmin: boolean;
  readonly departmentIds: readonly string[];
  /** Projects the account may read. */
  readonly projectIds: readonly string[];
}

/** A node of the page tree; the tree itself is built from a flat list. */
export interface WikiTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly position: number;
  readonly currentUntil: string | null;
}

/** A project that has wiki pages, named for the navigation. */
export interface WikiProjectArea {
  readonly id: string;
  readonly name: string;
}

/** What the left navigation of the wiki shows. */
export interface WikiNavigation {
  readonly nodes: readonly WikiTreeNode[];
  readonly projects: readonly WikiProjectArea[];
  readonly favoriteIds: readonly string[];
  readonly expandedIds: readonly string[];
  readonly recent: readonly WikiPageLink[];
  readonly canCreate: boolean;
}

/** What the wiki start page lists. */
export interface WikiHome {
  readonly recentlyEdited: readonly WikiPageSummary[];
  readonly mine: readonly WikiPageSummary[];
  readonly favorites: readonly WikiPageSummary[];
  readonly all: readonly WikiPageSummary[];
}

/** A page named by its identity, for lists and links. */
export interface WikiPageLink {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

/** One row of the table "All pages" and of search results. */
export interface WikiPageSummary extends WikiPageLink {
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly parentId: string | null;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly currentUntil: string | null;
  readonly updatedAt: string;
  readonly createdAt: string;
}

/** A page with everything the page view and the editor need. */
export interface WikiPage extends WikiPageSummary {
  readonly content: string;
  readonly revision: number;
  readonly isTemplate: boolean;
  readonly updatedByName: string | null;
  readonly anchors: readonly WikiAnchorTarget[];
  /** The pages above this one, from the root down; only visible ones. */
  readonly breadcrumb: readonly WikiPageLink[];
}

/** What the current account may do with a page. */
export interface WikiPagePermissions {
  readonly canEdit: boolean;
  readonly canManage: boolean;
  readonly canComment: boolean;
}

/** A page together with the rights of the viewer. */
export interface WikiPageView {
  readonly page: WikiPage;
  readonly permissions: WikiPagePermissions;
  readonly isFavorite: boolean;
  /** Direct children, in order. */
  readonly children: readonly WikiPageLink[];
}

/** What an administrator sees of a private page: no title, no text. */
export interface WikiPrivatePlaceholder {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerName: string;
}

/** The private pages of each account as an administrator sees them. */
export type WikiPrivatePagesByOwner = Readonly<
  Record<string, readonly WikiPrivatePlaceholder[]>
>;

/** Number of Unicode characters of a text, the unit of the wiki limits. */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/** Settings an administrator changes in the system settings. */
export interface WikiSettings {
  /** Days a deleted page stays in the trash. */
  readonly trashRetentionDays: number;
  /** Days a version is kept. */
  readonly versionRetentionDays: number;
  /** Number of newest versions per page that are kept in any case. */
  readonly versionKeepLast: number;
  /** Largest media file (image, audio, video), in bytes. */
  readonly mediaLimitBytes: number;
  /** Largest file of any other kind, in bytes. */
  readonly fileLimitBytes: number;
}

const MEBIBYTE = 1024 * 1024;

/** Values that apply until an administrator changes them (T4.7.7, T4.9.13). */
export const WIKI_SETTING_DEFAULTS: WikiSettings = {
  trashRetentionDays: 30,
  versionRetentionDays: 90,
  versionKeepLast: 50,
  mediaLimitBytes: 500 * MEBIBYTE,
  fileLimitBytes: 100 * MEBIBYTE,
};

/** Smallest and largest value of each setting. */
export const WIKI_SETTING_RANGES: Readonly<
  Record<keyof WikiSettings, { readonly min: number; readonly max: number }>
> = {
  trashRetentionDays: { min: 1, max: 3650 },
  versionRetentionDays: { min: 1, max: 3650 },
  versionKeepLast: { min: 1, max: 1000 },
  mediaLimitBytes: { min: MEBIBYTE, max: 100 * 1024 * MEBIBYTE },
  fileLimitBytes: { min: MEBIBYTE, max: 100 * 1024 * MEBIBYTE },
};

/** How a move changes who sees a page. */
export type WikiVisibilityChange = "same" | "wider" | "narrower" | "different";

const SCOPE_REACH: Readonly<Record<WikiScope, number>> = {
  [WIKI_SCOPE.PRIVATE]: 0,
  [WIKI_SCOPE.PROJECT]: 1,
  [WIKI_SCOPE.INSTANCE]: 2,
};

/**
 * Compares the audience of a page before and after a move.
 *
 * @param before - Scope and project before the move.
 * @param after - Scope and project after the move.
 * @returns Only the direction, never names or numbers of people (T4.6.6).
 */
export function compareAudience(
  before: WikiPlacementScope,
  after: WikiPlacementScope,
): WikiVisibilityChange {
  if (before.scope === after.scope) {
    return before.projectId === after.projectId ? "same" : "different";
  }

  return SCOPE_REACH[after.scope] > SCOPE_REACH[before.scope]
    ? "wider"
    : "narrower";
}

/**
 * Tells how a move changes who sees a page when only the anchors it inherits
 * from the pages above it change.
 *
 * @param before - Anchors the page inherited from its old parents, as keys.
 * @param after - Anchors it inherits from its new parents, as keys.
 * @returns "narrower" when it gains an anchor, "wider" when it loses one,
 * "different" when it does both, otherwise "same". Never names or numbers.
 */
export function compareInheritedAnchors(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): WikiVisibilityChange {
  const gained = [...after].some((key) => !before.has(key));
  const lost = [...before].some((key) => !after.has(key));

  if (gained && lost) {
    return "different";
  }

  if (gained) {
    return "narrower";
  }

  return lost ? "wider" : "same";
}

/** What a person can tie a page to, and what the page is tied to now. */
export interface WikiAnchorChoices {
  readonly departments: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly projectName: string;
  }[];
  readonly epics: readonly {
    readonly id: string;
    readonly key: string;
    readonly title: string;
  }[];
  readonly selected: readonly WikiAnchor[];
}

/** An account that can own a page. */
export interface WikiOwnerCandidate {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Brings a page title into its stored form: one line without surrounding
 * blanks, inner runs of whitespace collapsed to one blank.
 *
 * @param title - Title as typed.
 * @returns The normalized title.
 */
export function normalizeWikiTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/** A search hit: the page and a passage around the first match. */
export interface WikiSearchResult extends WikiPageSummary {
  readonly snippet: string;
}

/** The answer to a search. */
export interface WikiSearchResponse {
  readonly results: readonly WikiSearchResult[];
  /** Number of all hits the person may see; at least `results.length`. */
  readonly total: number;
}

/** Something the reference picker offers to link or mention. */
export type WikiReference =
  | {
      readonly kind: "page";
      readonly id: string;
      readonly title: string;
      readonly icon: string | null;
    }
  | { readonly kind: "ticket"; readonly key: string; readonly title: string }
  | {
      readonly kind: "person";
      readonly id: string;
      readonly username: string;
      readonly displayName: string;
    };

/** Where a page is mentioned. */
export interface WikiBacklinks {
  readonly pages: readonly WikiPageLink[];
  readonly tickets: readonly {
    readonly id: string;
    readonly key: string;
    readonly title: string;
  }[];
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

/** A file attached to a page. */
export interface WikiAttachment {
  readonly id: string;
  readonly pageId: string;
  readonly fileName: string;
  /** The type the server serves the file as. */
  readonly contentType: string;
  readonly kind: "media" | "file";
  readonly size: number;
  readonly uploadedBy: string;
  readonly uploadedByName: string;
  readonly createdAt: string;
  /** Whether the file may appear inside a page as an image. */
  readonly isEmbeddable: boolean;
}

/** A comment below a page or on a passage of its text. */
export interface WikiComment {
  readonly id: string;
  readonly pageId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The passage the comment refers to; `null` for a comment on the page. */
  readonly quote: string | null;
  readonly quotePrefix: string | null;
  readonly quoteSuffix: string | null;
  /** True when the passage is no longer in the text ("Stelle geändert"). */
  readonly isStale: boolean;
  readonly resolvedAt: string | null;
  readonly resolvedByName: string | null;
  /** Whether the viewer may delete this comment (author, owner, administrator). */
  readonly canChange: boolean;
  /** Whether the viewer may edit the text (the author only). */
  readonly canEdit: boolean;
}

/** A first comment together with the replies to it. */
export interface WikiCommentThread {
  readonly comment: WikiComment;
  readonly replies: readonly WikiComment[];
}

/** Why an entry appears in "For me". */
export type WikiFeedReason = "mention" | "reply" | "comment" | "expired";

/** One entry of "For me". */
export interface WikiFeedItem {
  readonly reason: WikiFeedReason;
  readonly pageId: string;
  readonly pageTitle: string;
  /** The comment or mention text; empty for an expired page. */
  readonly excerpt: string;
  readonly actorName: string;
  readonly at: string;
  readonly isUnread: boolean;
}
