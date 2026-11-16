import type { getApplicationServices } from "@/app/lib/services.server";
import type {
  ConversationDecisionEntry,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** The services of the chat page. */
export type ChatPageServices = Awaited<
  ReturnType<typeof getApplicationServices>
>;

/**
 * Makes a group of the person a conversation its members share and adds the
 * members it gained, so they see the group and its history.
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
 * a person, creating it on first use.
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

/**
 * Reads or changes who answers in a group; only the one who manages the group changes it.
 * @param services - The application services.
 * @param person - The signed-in person.
 * @param intent - The reply settings intent.
 * @param formData - The form fields.
 * @returns The reply settings or recent reply decisions.
 */
export async function runReplySettingsIntent(
  services: ChatPageServices,
  person: User,
  intent: "reply-settings" | "save-reply-settings" | "reply-decisions",
  formData: FormData,
): Promise<{
  readonly replySettings?: ConversationReplySettingsView;
  readonly replyDecisions?: readonly ConversationDecisionEntry[];
}> {
  const { conversationReplySettingsService } = services;
  if (intent === "reply-settings")
    return {
      replySettings: await conversationReplySettingsService.read(
        person,
        formData.get("conversationId"),
      ),
    };
  if (intent === "reply-decisions")
    return {
      replyDecisions: await conversationReplySettingsService.decisions(
        person,
        formData.get("conversationId"),
      ),
    };
  return {
    replySettings: await conversationReplySettingsService.save(person, {
      conversationId: formData.get("conversationId"),
      mode: formData.get("mode"),
      // Without values of its own a group follows the defaults of the instance.
      rules:
        formData.get("useDefaults") === "true"
          ? null
          : {
              answerThreshold: Number(formData.get("answerThreshold")),
              responsibilityThreshold: Number(
                formData.get("responsibilityThreshold"),
              ),
              secondThreshold: Number(formData.get("secondThreshold")),
              maximumResponders: Number(formData.get("maximumResponders")),
            },
      ...(formData.has("automaticRepliesPerOrigin")
        ? {
            automaticRepliesPerOrigin: Number(
              formData.get("automaticRepliesPerOrigin"),
            ),
          }
        : {}),
    }),
  };
}
