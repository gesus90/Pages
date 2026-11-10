import type {
  WikiAnchorKind,
  WikiPagePermissions,
  WikiScope,
  WikiTreeNode,
  WikiVisibilityChange,
} from "@/definition/Wiki";

/** A person as the wiki API names them: by username, never by internal id. */
export interface McpWikiPerson {
  readonly username: string;
  readonly displayName: string;
}

/** A page named by its identifier and title. */
export interface McpWikiPageName {
  readonly id: string;
  readonly title: string;
}

/**
 * The answer object "Seite" of the interface (PAGE-257).
 *
 * @remarks
 * A projection of its own: no cover, no internal account id and nothing of a
 * page above or below that the account may not see.
 */
export interface McpWikiPage {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly parentId: string | null;
  readonly owner: McpWikiPerson;
  readonly currentUntil: string | null;
  readonly content: string;
  readonly revision: number;
  readonly isTemplate: boolean;
  readonly anchors: readonly {
    readonly kind: WikiAnchorKind;
    readonly targetId: string;
    readonly label: string | null;
  }[];
  readonly breadcrumb: readonly McpWikiPageName[];
  readonly children: readonly McpWikiPageName[];
  readonly permissions: WikiPagePermissions;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The answer of the page tree (interface 1). */
export interface McpWikiTree {
  readonly pages: readonly WikiTreeNode[];
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly canCreate: boolean;
}

/** One hit of a search (interface 2). */
export interface McpWikiSearchResult {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly parentId: string | null;
  readonly updatedAt: string;
}

/** A page read with the pages that mention it (interface 3 with `backlinks=1`). */
export interface McpWikiPageRead {
  readonly page: McpWikiPage;
  readonly backlinks?: readonly McpWikiPageName[];
}

/** The answer of a move preview (interface 7). */
export interface McpWikiMovePreview {
  readonly preview: WikiVisibilityChange;
}

/** One version of a page without its text (interface 9). */
export interface McpWikiVersionSummary {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly author: McpWikiPerson;
  readonly createdAt: string;
}

/** One version of a page with its text (interface 9). */
export interface McpWikiVersion extends McpWikiVersionSummary {
  readonly content: string;
}

/** The question a move into the trash asks before it changes anything (interface 11). */
export interface McpWikiDeleteConfirmation {
  readonly confirmationRequired: true;
  readonly page: McpWikiPageName;
  readonly affected: readonly McpWikiPageName[];
}

/**
 * The question before a private page of somebody else goes into its owner's
 * trash: identifier and owner only, never a title or text (PAGE-280).
 */
export interface McpWikiPlaceholderConfirmation {
  readonly confirmationRequired: true;
  readonly placeholder: { readonly id: string; readonly ownerId: string };
}

/** The question a purge asks before it changes anything (interface 14). */
export interface McpWikiPurgeConfirmation extends McpWikiDeleteConfirmation {
  readonly attachmentCount: number;
}

/** One page in the trash (interface 12). */
export interface McpWikiTrashEntry {
  readonly id: string;
  readonly title: string;
  readonly scope: WikiScope;
  readonly projectId: string | null;
  readonly deletedAt: string;
}

/** The answer object "Kommentar" of the interface (15). */
export interface McpWikiComment {
  readonly id: string;
  readonly parentId: string | null;
  readonly author: McpWikiPerson;
  readonly body: string;
  readonly quote: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The answer object "Anhang" of the interface (16), without storage names or uploader ids. */
export interface McpWikiAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly kind: "media" | "file";
  readonly size: number;
  readonly createdAt: string;
}
