import type { getApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";
import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** The services of the chat page. */
export type ChatPageServices = Awaited<
  ReturnType<typeof getApplicationServices>
>;

/**
 * Makes a group of the person a conversation its members share and adds the
 * members it gained, so they see the group and its history (PAGE-278).
 *
 * @param services - The application services.
 * @param person - The signed-in person.
 * @param groupId - The group of the page, as the request names it.
 * @returns Whether the group is one of the person's own groups.
 */
export async function shareChatGroup(
  services: ChatPageServices,
  person: User,
  groupId: unknown,
): Promise<boolean> {
  const group = await services.chatGroupService.find(person, groupId);
  if (!group) return false;
  await services.conversationService.adoptGroup(person, group);
  return true;
}

/**
 * Opens the stored conversation of a group or of a direct conversation with
 * a person, creating it on first use (PAGE-277).
 *
 * @param services - The application services.
 * @param person - The signed-in person.
 * @param selection - The group or participant the page has opened.
 * @returns The conversation ID and whether the page keeps an activity for it.
 * @throws {ConversationError} As {@link ConversationService.openDirect}.
 */
export async function openChatConversation(
  services: ChatPageServices,
  person: User,
  selection: VirtualChatSelection,
): Promise<{ readonly conversationId: string; readonly isOwn: boolean }> {
  if (selection.kind === "group") {
    const isOwn = await shareChatGroup(services, person, selection.id);
    return { conversationId: selection.id, isOwn };
  }
  const conversation = await services.conversationService.openDirect(
    person,
    selection.id,
  );
  return { conversationId: conversation.id, isOwn: true };
}
