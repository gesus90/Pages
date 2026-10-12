/** Operations that change the comments of a wiki page. */
export type AgentWikiCommentWriteOperation =
  | "wiki.comment.add"
  | "wiki.comment.edit"
  | "wiki.comment.resolve"
  | "wiki.comment.delete";

/** The comment an operation addresses, bound to the operation ID the caller chose. */
export interface AgentWikiCommentTarget {
  readonly operationId: string;
  readonly commentId: string;
}

/** A new first comment or a reply; the person who connected the agent is its author. */
export interface AgentWikiCommentAddInput {
  readonly operationId: string;
  /** Always a page identifier; a Pages address is resolved before this contract. */
  readonly pageId: string;
  /** The first comment this one answers; `null` starts a new thread. */
  readonly parentId: string | null;
  readonly body: string;
  /** The passage of the page text the comment refers to; `null` for a comment on the page. */
  readonly quote: string | null;
}

/** The new text of a comment; only its author may change it. */
export interface AgentWikiCommentEditInput extends AgentWikiCommentTarget {
  readonly body: string;
}

/** Resolves a thread, or opens it again. */
export interface AgentWikiCommentResolveInput extends AgentWikiCommentTarget {
  readonly resolved: boolean;
}

/** A comment as an agent reads it; people appear by display name only. */
export interface AgentWikiComment {
  readonly id: string;
  /** The first comment this one answers; `null` for the first comment of a thread. */
  readonly parentId: string | null;
  readonly authorName: string;
  readonly body: string;
  /** The passage the comment refers to; `null` for a comment on the page. */
  readonly quote: string | null;
  /** True when the passage is no longer in the page text. */
  readonly isStale: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isResolved: boolean;
  readonly resolvedAt: string | null;
  readonly resolvedByName: string | null;
  /** Whether the connected account may change the text: its author only. */
  readonly canEdit: boolean;
  /** Whether the connected account may delete the comment with its replies. */
  readonly canDelete: boolean;
}

/** A first comment together with the replies to it. */
export interface AgentWikiCommentThread {
  readonly comment: AgentWikiComment;
  readonly replies: readonly AgentWikiComment[];
}

/** The comments of one visible page, oldest thread first. */
export interface AgentWikiComments {
  readonly total?: number;
  readonly nextCursor?: string | null;
  readonly pageId: string;
  readonly link: string;
  readonly threads: readonly AgentWikiCommentThread[];
}

/** Result of an add; returned unchanged when the operation ID is repeated. */
export interface AgentWikiCommentAdded {
  readonly commentId: string;
  readonly pageId: string;
  readonly link: string;
  readonly parentId: string | null;
  /** True when the quoted passage is not in the page text. */
  readonly isStale: boolean;
}

/** Result of an edit, resolve or delete; returned unchanged when the operation ID is repeated. */
export interface AgentWikiCommentChanged {
  readonly commentId: string;
  readonly pageId: string;
  readonly link: string;
  readonly action: "edited" | "resolved" | "reopened" | "deleted";
  /** Whether the call wrote anything; a text or state that is already set is not written again. */
  readonly changed: boolean;
  /** Comments the call removed: the comment and its replies; `0` for every other action. */
  readonly deletedComments: number;
}
