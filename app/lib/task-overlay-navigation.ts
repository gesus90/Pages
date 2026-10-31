import type { ShouldRevalidateFunctionArgs } from "react-router";

/** Ticket actions whose responses replace the affected board cards. */
export const BOARD_TICKET_UPDATE_INTENTS: ReadonlySet<string> = new Set([
  "update-task",
  "set-ticket-status",
  "set-department",
  "change-parent",
  "create-task",
  "move-project",
  "archive-task",
  "restore-task",
]);

/** Detail-only actions that leave the board cards and hierarchy unchanged. */
export const BOARD_DETAIL_INTENTS: ReadonlySet<string> = new Set([
  "label-assign",
  "label-unassign",
  "checklist-add",
  "checklist-toggle",
  "checklist-delete",
  "link-add",
  "link-remove",
  "remove-attachment",
]);

const OVERLAY_TICKET_INTENTS: ReadonlySet<string> = new Set([
  ...BOARD_TICKET_UPDATE_INTENTS,
  ...BOARD_DETAIL_INTENTS,
]);

/** Recognizes a completed ticket change that does not alter shell settings. */
export function isTaskOverlayMutation({
  currentUrl,
  nextUrl,
  formData,
  actionResult,
}: ShouldRevalidateFunctionArgs): boolean {
  const intent = formData?.get("intent");
  const result: unknown = actionResult;
  return (
    currentUrl.pathname === nextUrl.pathname &&
    (currentUrl.pathname === "/aufgaben" || currentUrl.pathname === "/tasks") &&
    currentUrl.searchParams.has("item") &&
    typeof intent === "string" &&
    OVERLAY_TICKET_INTENTS.has(intent) &&
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    result.ok === true
  );
}

/** Recognizes an overlay-only navigation without changing authentication or preferences. */
export function isTaskOverlayNavigation({
  currentUrl,
  nextUrl,
  formData,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formData || currentUrl.pathname !== nextUrl.pathname) return false;
  if (currentUrl.pathname !== "/aufgaben" && currentUrl.pathname !== "/tasks")
    return false;
  const current = new URLSearchParams(currentUrl.searchParams);
  const next = new URLSearchParams(nextUrl.searchParams);
  if (current.get("item") === next.get("item")) return false;
  current.delete("item");
  next.delete("item");
  return current.toString() === next.toString();
}
