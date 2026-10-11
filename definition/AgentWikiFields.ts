import type { WikiVisibilityChange } from "./Wiki.js";

/** The page fields an agent changes one at a time. */
export type AgentWikiField = "title" | "content" | "icon";

/** Operations that change exactly one field of a page. */
export type AgentWikiFieldOperation =
  "wiki.page.setTitle" | "wiki.page.setContent" | "wiki.page.setIcon";

/** Every operation of this family: three single-field changes and the move. */
export type AgentWikiPageOperation = AgentWikiFieldOperation | "wiki.page.move";

/** The page an operation addresses, bound to the revision the caller read. */
export interface AgentWikiPageTarget {
  readonly operationId: string;
  /** Always a page identifier; a Pages address is resolved before this contract. */
  readonly pageId: string;
  readonly expectedRevision: number;
}

/** The single field to change and its new value. */
export type AgentWikiFieldChange =
  | { readonly field: "title" | "content"; readonly value: string }
  /** `null` removes the icon. */
  | { readonly field: "icon"; readonly value: string | null };

/** One field of one page; the other fields stay as they are. */
export type AgentWikiFieldInput = AgentWikiPageTarget & AgentWikiFieldChange;

/** An explicit place inside a project; the page keeps its text and icon. */
export interface AgentWikiMoveInput extends AgentWikiPageTarget {
  readonly projectId: string;
  /** Page above, or `null` for a root page of the project. */
  readonly parentId: string | null;
  /** Sibling the page is placed before, or `null` to append it. */
  readonly beforeId: string | null;
}

/** Result of a field change; returned unchanged when the operation ID is repeated. */
export interface AgentWikiPageChanged {
  readonly pageId: string;
  readonly link: string;
  readonly field: AgentWikiField;
  /** The page revision after the call; unchanged when the value was already set. */
  readonly revision: number;
  /** Whether the call wrote anything. */
  readonly changed: boolean;
}

/** Result of a move; returned unchanged when the operation ID is repeated. */
export interface AgentWikiPageMoved {
  readonly pageId: string;
  readonly link: string;
  readonly field: "location";
  /** A move keeps the revision, which counts changes of title, text and icon. */
  readonly revision: number;
  readonly changed: boolean;
  readonly parentId: string | null;
  readonly projectId: string;
  /** How the move changed who sees the page; never names or numbers of people. */
  readonly visibility: WikiVisibilityChange;
}
