import { createContext, use } from "react";

import type { ConversationMentionDirectory } from "@/definition/ConversationMention";

/** Mention identities are read once with the rights of the signed-in account. */
export const MentionDirectoryContext = createContext<
  ConversationMentionDirectory | undefined
>(undefined);

/** Allows standalone chats to retain their normal rendering without a directory. */
export function useMentionDirectory():
  ConversationMentionDirectory | undefined {
  return use(MentionDirectoryContext);
}
