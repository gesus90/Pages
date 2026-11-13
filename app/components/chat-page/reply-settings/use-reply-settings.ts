import { useEffect } from "react";
import { useFetcher } from "react-router";

import type {
  ConversationDecisionEntry,
  ConversationDecisionRules,
  ConversationReplyMode,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";

/** What the chat page answers to the intents of the popup "Wer antwortet?". */
interface ReplyAnswer {
  readonly ok: boolean;
  readonly intent?: string;
  readonly replySettings?: ConversationReplySettingsView;
  readonly replyDecisions?: readonly ConversationDecisionEntry[];
}

function isReplyAnswer(value: unknown): value is ReplyAnswer {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** The settings the server answered for this group, or `null`. */
function readSettings(
  answer: unknown,
  groupId: string,
): ConversationReplySettingsView | null {
  if (!isReplyAnswer(answer) || !answer.replySettings) return null;
  return answer.replySettings.conversationId === groupId
    ? answer.replySettings
    : null;
}

/** What a manager submits: the mode and the rules; `null` follows the defaults of the instance. */
export interface ReplySettingsDraft {
  readonly mode: ConversationReplyMode;
  readonly rules: ConversationDecisionRules | null;
}

/** The popup's view of the settings, the last decisions and the save. */
export interface ReplySettingsState {
  readonly settings: ConversationReplySettingsView | null;
  /** `null` until the list arrived. */
  readonly decisions: readonly ConversationDecisionEntry[] | null;
  /** Whether the settings are on their way. */
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly isSaved: boolean;
  readonly isSaveFailed: boolean;
  readonly save: (draft: ReplySettingsDraft) => void;
}

/** Whether the last save worked; `null` while there is none or it is running. */
function saveResult(
  answer: ReplyAnswer | null,
  isSaving: boolean,
): boolean | null {
  if (answer === null || isSaving) return null;
  return answer.intent === "save-reply-settings" ? answer.ok : null;
}

function submitIntent(
  submit: ReturnType<typeof useFetcher>["submit"],
  intent: string,
  groupId: string,
): void {
  const formData = new FormData();
  formData.set("intent", intent);
  formData.set("conversationId", groupId);
  void submit(formData, { method: "post" });
}

/**
 * Reads the settings and the last decisions of a group whenever the popup
 * opens, and saves the settings of a manager (PAGE-379).
 *
 * @param groupId - The group of the popup.
 * @param isOpen - Whether the popup is open; it reads on every opening.
 */
export function useReplySettings(
  groupId: string,
  isOpen: boolean,
): ReplySettingsState {
  const reader = useFetcher();
  const decisionReader = useFetcher();
  const writer = useFetcher();
  const { submit: readSettingsOf } = reader;
  const { submit: readDecisionsOf } = decisionReader;
  const saved = readSettings(writer.data, groupId);
  const isSaving = writer.state !== "idle";

  useEffect(() => {
    if (!isOpen) return;
    submitIntent(readSettingsOf, "reply-settings", groupId);
    submitIntent(readDecisionsOf, "reply-decisions", groupId);
  }, [isOpen, groupId, readSettingsOf, readDecisionsOf]);

  function save(draft: ReplySettingsDraft): void {
    const formData = new FormData();
    formData.set("intent", "save-reply-settings");
    formData.set("conversationId", groupId);
    formData.set("mode", draft.mode);
    formData.set("useDefaults", String(draft.rules === null));
    if (draft.rules !== null)
      for (const [rule, value] of Object.entries(draft.rules))
        formData.set(rule, String(value));
    void writer.submit(formData, { method: "post" });
  }

  const decisions = isReplyAnswer(decisionReader.data)
    ? (decisionReader.data.replyDecisions ?? null)
    : null;
  const result = saveResult(
    isReplyAnswer(writer.data) ? writer.data : null,
    isSaving,
  );
  return {
    settings: saved ?? readSettings(reader.data, groupId),
    decisions,
    isLoading: reader.state !== "idle",
    isSaving,
    isSaved: result === true,
    isSaveFailed: result === false,
    save,
  };
}
