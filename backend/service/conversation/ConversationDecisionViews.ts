import type {
  StoredConversationDecision,
  StoredDecisionListing,
} from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type {
  ConversationDecisionAgent,
  ConversationDecisionEntry,
  ConversationDecisionView,
} from "@/definition/ConversationDecision";
import type { ConversationAccounts } from "./ConversationDirectory";

/** The longest text of a message the list of decisions shows. */
const LISTED_TEXT_CHARACTERS = 160;

function agentOf(
  id: string,
  accounts: ConversationAccounts,
): ConversationDecisionAgent {
  return { id, name: accounts.participant(id).name };
}

/**
 * The decision about a message as the chat shows it (PAGE-379).
 *
 * @param stored - The stored decision.
 * @param accounts - The accounts that name the agents.
 * @returns The outcome, the agents that answer, the chance that an answer is
 * expected and the probability of every option, the most probable first. The
 * option "nobody" has no agent and no name.
 */
export function decisionView(
  stored: StoredConversationDecision,
  accounts: ConversationAccounts,
): ConversationDecisionView {
  return {
    messageId: stored.messageId,
    outcome: stored.outcome,
    fallback: stored.fallback,
    responders: stored.responderIds.map((id) => agentOf(id, accounts)),
    answerProbability: stored.answerProbability,
    choices: stored.choices.map((choice) => ({
      agentId: choice.agentId,
      name:
        choice.agentId === null
          ? ""
          : accounts.participant(choice.agentId).name,
      probability: choice.probability,
    })),
    model: stored.model,
  };
}

/**
 * One decision of the list of a group.
 *
 * @param listing - The stored decision with the text of its message.
 * @param accounts - The accounts that name the agents.
 * @returns The decision with the shortened text of its message and its time.
 */
export function decisionEntry(
  listing: StoredDecisionListing,
  accounts: ConversationAccounts,
): ConversationDecisionEntry {
  const characters = Array.from(listing.text.replace(/\s+/gu, " ").trim());
  const text =
    characters.length <= LISTED_TEXT_CHARACTERS
      ? characters.join("")
      : `${characters
          .slice(0, LISTED_TEXT_CHARACTERS - 1)
          .join("")
          .trimEnd()}…`;
  return {
    ...decisionView(listing, accounts),
    text,
    createdAt: listing.createdAt,
  };
}
