import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/** The existing rights-checked chat page endpoint, also used for notification previews. */
export const CHAT_PAGE_ENDPOINT = "/chat-page-api/page";

/** Recognizes the directory returned by the chat page endpoint. */
export function isChatDirectory(value: unknown): value is VirtualChatDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    "participants" in value &&
    Array.isArray(value.participants) &&
    "groups" in value &&
    Array.isArray(value.groups) &&
    "contactChoices" in value &&
    Array.isArray(value.contactChoices) &&
    "histories" in value &&
    typeof value.histories === "object" &&
    value.histories !== null
  );
}
