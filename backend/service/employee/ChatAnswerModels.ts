import { addConversationQuestions } from "./ChatDirectoryView";

import type { ChatAnswerModelRepository } from "@/backend/database/repositories/conversation/ChatAnswerModelRepository";
import type { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import type { User } from "@/definition/User";
import type { VirtualChatMessage } from "@/definition/VirtualChat";

/** Reads the models kept with stored answers. */
export type AnswerModelReader = Pick<ChatAnswerModelRepository, "forMessages">;

/** The histories of the chat page, by chat. */
type Histories = Readonly<Record<string, readonly VirtualChatMessage[]>>;

/**
 * Adds the model each answer of an agent was written with, where Pages kept
 * it, so the head of a stored answer reads as it did while it was written.
 * @param answerModels - The stored models; absent adds none.
 * @param histories - The histories of the chat page, by chat.
 * @returns The histories with `answerModel` on the answers that have one;
 * the person's own messages and older answers stay as they are.
 */
export async function addAnswerModels(
  answerModels: AnswerModelReader | undefined,
  histories: Histories,
): Promise<Record<string, readonly VirtualChatMessage[]>> {
  if (!answerModels) return { ...histories };
  const ids = Object.values(histories).flatMap((messages) =>
    messages
      .filter((message) => message.authorId !== null)
      .map((message) => message.id),
  );
  const models = await answerModels.forMessages(ids);
  if (models.size === 0) return { ...histories };
  return Object.fromEntries(
    Object.entries(histories).map(([id, messages]) => [
      id,
      messages.map((message) => {
        const answerModel =
          message.authorId === null ? undefined : models.get(message.id);
        return answerModel ? { ...message, answerModel } : message;
      }),
    ]),
  );
}

/**
 * Adds what the chat page shows with stored answers: the cards of the
 * questions of agents and the model each answer was written with.
 * @param dependencies - The questions and the stored models; each one absent adds nothing.
 * @param person - The reader, whose questions the cards answer.
 * @param histories - The histories of the chat page, by chat.
 */
export async function addAnswerDetails(
  dependencies: {
    readonly questions?: Pick<AgentChatQuestionService, "views">;
    readonly answerModels?: AnswerModelReader;
  },
  person: User,
  histories: Histories,
): Promise<Record<string, readonly VirtualChatMessage[]>> {
  const withQuestions = await addConversationQuestions(
    dependencies.questions,
    person,
    histories,
  );
  return addAnswerModels(dependencies.answerModels, withQuestions);
}
