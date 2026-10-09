import { Outlet } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { TicketTreeEntry } from "@/definition/Task";
import type { Route } from "./+types/tasks-layout";

/** What the ticket tree of the sidebar shows. */
export interface TicketLayoutData {
  /** The active tickets the person sees, as on the board. */
  readonly entries: readonly TicketTreeEntry[];
  /** The branches the person opened. */
  readonly expandedKeys: readonly string[];
}

/** Changes that leave the tree as it is; everything else reloads it. */
const TREE_NEUTRAL_INTENTS: ReadonlySet<string> = new Set([
  "save-board-preferences",
  "set-tree-expanded",
]);

/** Loads the ticket tree for the sidebar of every ticket page (A8.2-E08). */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<TicketLayoutData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const { ticketTreeService } = await getApplicationServices();

  return {
    entries: await ticketTreeService.findEntries(actor),
    expandedKeys: await ticketTreeService.findExpandedKeys(actor),
  };
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
