import { Outlet } from "react-router";

import { loadLocalFirst } from "@/app/lib/local-state/local-state-loader";
import {
  readTicketTree,
  TICKET_TREE_ENDPOINT,
  TICKET_TREE_STATE,
} from "@/app/lib/ticket-tree-state";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { TicketTreeEntry } from "@/definition/Task";
import type { Route } from "./+types/tasks-layout";

/** What the ticket tree of the sidebar shows. */
export interface TicketLayoutData {
  /** The active tickets the person sees, as on the board. */
  readonly entries: readonly TicketTreeEntry[];
  /** The branches the person opened. */
  readonly expandedKeys: readonly string[];
  readonly audience: LocalStateAudience;
}

/** Changes that leave the tree as it is; everything else reloads it. */
const TREE_NEUTRAL_INTENTS: ReadonlySet<string> = new Set([
  "save-board-preferences",
  "set-tree-expanded",
  "set-department",
  "label-assign",
  "label-unassign",
  "checklist-add",
  "checklist-toggle",
  "checklist-delete",
  "link-add",
  "link-remove",
  "remove-attachment",
]);

/**
 * Opens the tree from the account's kept answer at once; the sidebar asks the endpoint behind it.
 *
 * @remarks
 * Without a kept answer the tree comes from its rights-checked endpoint,
 * which runs the server loader's checks.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<TicketLayoutData>> {
  return loadLocalFirst(TICKET_TREE_ENDPOINT, TICKET_TREE_STATE, () =>
    readTicketTree(request.signal),
  );
}

/**
 * Reloads the tree after a change and when the page is refreshed, not when
 * the person only moves between ticket pages and board views.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  const intent = formData?.get("intent");

  if (typeof intent === "string" && TREE_NEUTRAL_INTENTS.has(intent)) {
    return false;
  }

  return formData || currentUrl.href === nextUrl.href
    ? defaultShouldRevalidate
    : false;
}

/** Renders the ticket pages; the tree itself lives in the main sidebar. */
export default function TasksLayout(): React.ReactElement {
  return <Outlet />;
}
