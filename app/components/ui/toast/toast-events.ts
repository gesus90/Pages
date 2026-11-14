import type { ToastInput } from "./toast-types";

/** The document-local channel used by every page. */
export const TOAST_EVENT = "pages:toast";
/** Retained for existing document integrations. */
export const SUCCESS_EVENT = "pages:success";

/** Shows a localized notice through the document's shared toaster. Safe during SSR. */
export function showToast(notice: ToastInput): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: notice }));
}

/** Announces a completed client-side action; existing callers keep their success appearance. */
export function showSuccessToast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SUCCESS_EVENT, { detail: message }));
}

/** Rejects malformed document events before they enter the shared state. */
export function isToastInput(value: unknown): value is ToastInput {
  if (typeof value !== "object" || value === null) return false;
  if (!("message" in value) || typeof value.message !== "string") return false;
  if (!("type" in value)) return false;
  if (
    "description" in value &&
    value.description !== undefined &&
    typeof value.description !== "string"
  )
    return false;
  if (
    "action" in value &&
    value.action !== undefined &&
    !isToastAction(value.action)
  )
    return false;
  if (value.type === "chat") return isChatNotice(value);
  return (
    typeof value.type === "string" &&
    ["success", "info", "warning", "error"].includes(value.type)
  );
}

function isToastAction(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string" &&
    "onClick" in value &&
    typeof value.onClick === "function"
  );
}

function isChatNotice(value: object): boolean {
  if (
    !("chat" in value) ||
    typeof value.chat !== "object" ||
    value.chat === null
  )
    return false;
  const chat = value.chat;
  return (
    "id" in chat &&
    typeof chat.id === "string" &&
    "kind" in chat &&
    (chat.kind === "group" || chat.kind === "participant") &&
    "count" in value &&
    typeof value.count === "number" &&
    Number.isSafeInteger(value.count) &&
    value.count > 0
  );
}
