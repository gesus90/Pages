import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatPageRoundLimits } from "@/app/components/chat-page/chat-page-round-limits";
import { DecisionRulesFields } from "@/app/components/common/decision-rules-fields";
import { Button } from "@/app/components/ui/button";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { CONVERSATION_REPLY_MODES } from "@/definition/ConversationDecision";
import { conversationRoundLimits } from "@/definition/ConversationObserver";

import type {
  ConversationDecisionRules,
  ConversationReplyMode,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { ReplySettingsDraft } from "./use-reply-settings";

interface ReplyAnswersTabProps {
  readonly settings: ConversationReplySettingsView;
  readonly isSaving: boolean;
  readonly isSaved: boolean;
  readonly isSaveFailed: boolean;
  readonly onSave: (draft: ReplySettingsDraft) => void;
}

/** The decision model of the instance and whether it can decide now. */
function ModelLine({
  settings,
}: {
  readonly settings: ConversationReplySettingsView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { decisionModel } = settings;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-muted px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          {t("chatPage.replySettings.model.label")}
        </p>
        <p className="truncate font-medium text-foreground">
          {decisionModel.name ?? t("chatPage.replySettings.model.none")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`chatPage.replySettings.model.status.${decisionModel.status}`)} ·{" "}
        {t("chatPage.replySettings.model.where")}
      </p>
    </div>
  );
}

/** The hint a manager reads when decisions cannot run: the group then behaves like "Nur @". */
function Hint({
  hint,
}: {
  readonly hint: ConversationReplySettingsView["hint"];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (hint === null) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-warning-subtle px-4 py-3 text-sm text-warning"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{t(`chatPage.replySettings.hint.${hint}`)}</span>
    </p>
  );
}

/**
 * The tab "Antworten" (PAGE-379): the mode "Nur @" or "@ + Decision" with a
 * short explanation, the decision model of the instance, the thresholds and
 * the most answering agents as sliders (off in "Nur @"), and "Auf Standard
 * zurücksetzen". Only the one who manages the group changes anything.
 */
export function ReplyAnswersTab({
  settings,
  isSaving,
  isSaved,
  isSaveFailed,
  onSave,
}: ReplyAnswersTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ConversationReplyMode>(settings.mode);
  const [rules, setRules] = useState<ConversationDecisionRules>(settings.rules);
  const [isDefault, setIsDefault] = useState(settings.isDefault);
  const [limits, setLimits] = useState(conversationRoundLimits(settings));
  const canEdit = settings.canManage && !isSaving;
  const areRulesOff = !canEdit || mode === "mentions";

  function handleRulesChange(next: ConversationDecisionRules): void {
    setRules(next);
    setIsDefault(false);
  }

  function handleReset(): void {
    setRules(settings.defaults);
    setIsDefault(true);
  }

  function handleSubmit(event: React.SyntheticEvent): void {
    event.preventDefault();
    onSave({
      mode,
      rules: isDefault ? null : rules,
      automaticRepliesPerOrigin: limits.automaticRepliesPerOrigin,
    });
  }

  return (
    <form className="space-y-5 px-6 pt-5 pb-6" onSubmit={handleSubmit}>
      <Hint hint={settings.hint} />
      <div className="space-y-2">
        <SegmentedControl
          ariaLabel={t("chatPage.replySettings.mode")}
          value={mode}
          isDisabled={!canEdit}
          onValueChange={setMode}
          options={CONVERSATION_REPLY_MODES.map((entry) => ({
            value: entry,
            label: t(`chatPage.replySettings.modes.${entry}.label`),
          }))}
        />
        <p className="text-sm text-muted-foreground">
          {t(`chatPage.replySettings.modes.${mode}.description`)}
        </p>
      </div>
      <ModelLine settings={settings} />
      <DecisionRulesFields
        rules={rules}
        isDisabled={areRulesOff}
        onChange={handleRulesChange}
      />
      <ChatPageRoundLimits
        limits={limits}
        isDisabled={!canEdit}
        onChange={setLimits}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={areRulesOff || isDefault}
          onClick={handleReset}
        >
          {t("chatPage.replySettings.reset")}
        </Button>
        {settings.canManage ? (
          <Button type="submit" size="sm" disabled={isSaving}>
            {t("chatPage.replySettings.save")}
          </Button>
        ) : (
          <p role="note" className="text-sm text-muted-foreground">
            {t("chatPage.replySettings.readOnly")}
          </p>
        )}
      </div>
      {isSaved ? (
        <p role="status" className="text-sm text-success">
          {t("chatPage.replySettings.saved")}
        </p>
      ) : null}
      {isSaveFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("chatPage.replySettings.saveFailed")}
        </p>
      ) : null}
    </form>
  );
}
