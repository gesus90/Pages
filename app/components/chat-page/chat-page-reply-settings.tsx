import { MessageCircleQuestionMark } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";
import {
  CONVERSATION_MAXIMUM_RESPONDERS_RANGE,
  CONVERSATION_REPLY_MODES,
} from "@/definition/ConversationDecision";

import type {
  ConversationReplyMode,
  ConversationReplySettingsView,
} from "@/definition/ConversationDecision";
import type { VirtualGroup } from "@/definition/VirtualChat";

interface ReplySettingsAnswer {
  readonly ok: boolean;
  readonly intent?: string;
  readonly replySettings?: ConversationReplySettingsView;
}

function isReplySettingsAnswer(value: unknown): value is ReplySettingsAnswer {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** The settings the server answered for this group, or `null`. */
function readSettings(
  answer: unknown,
  groupId: string,
): ConversationReplySettingsView | null {
  if (!isReplySettingsAnswer(answer) || !answer.replySettings) return null;
  return answer.replySettings.conversationId === groupId
    ? answer.replySettings
    : null;
}

function FieldLabel({
  id,
  children,
}: {
  readonly id: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      htmlFor={id}
      className="mb-1.5 block text-sm leading-5 font-medium text-foreground"
    >
      {children}
    </label>
  );
}

/** The counts of answering agents a group may choose, from the least to the most. */
const MAXIMUM_CHOICES = Array.from(
  {
    length:
      CONVERSATION_MAXIMUM_RESPONDERS_RANGE.maximum -
      CONVERSATION_MAXIMUM_RESPONDERS_RANGE.minimum +
      1,
  },
  (_, index) => CONVERSATION_MAXIMUM_RESPONDERS_RANGE.minimum + index,
);

interface DraftSettings {
  readonly mode: ConversationReplyMode;
  readonly defaultResponderId: string;
  readonly maximumResponders: number;
}

function ReplySettingsForm({
  settings,
  isPending,
  onSave,
}: {
  readonly settings: ConversationReplySettingsView;
  readonly isPending: boolean;
  readonly onSave: (draft: DraftSettings) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [mode, setMode] = useState(settings.mode);
  const [defaultResponderId, setDefaultResponderId] = useState(
    settings.defaultResponderId ?? "",
  );
  const [maximumResponders, setMaximumResponders] = useState(
    settings.maximumResponders,
  );
  const isDisabled = !settings.canManage || isPending;

  function handleSubmit(event: React.SyntheticEvent): void {
    event.preventDefault();
    onSave({
      mode,
      defaultResponderId,
      maximumResponders: mode === "decision" ? 1 : maximumResponders,
    });
  }

  return (
    <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
      <div>
        <FieldLabel id="reply-mode">
          {t("chatPage.replySettings.mode")}
        </FieldLabel>
        <Select
          id="reply-mode"
          ariaLabel={t("chatPage.replySettings.mode")}
          value={mode}
          disabled={isDisabled}
          options={CONVERSATION_REPLY_MODES.map((entry) => ({
            value: entry,
            label: t(`chatPage.replySettings.modes.${entry}.label`),
            description: t(`chatPage.replySettings.modes.${entry}.description`),
          }))}
          onValueChange={setMode}
        />
      </div>
      <div>
        <FieldLabel id="reply-default">
          {t("chatPage.replySettings.defaultResponder")}
        </FieldLabel>
        <Select
          id="reply-default"
          ariaLabel={t("chatPage.replySettings.defaultResponder")}
          value={defaultResponderId}
          disabled={isDisabled}
          options={[
            { value: "", label: t("chatPage.replySettings.noDefault") },
            ...settings.agents.map((agent) => ({
              value: agent.id,
              label: agent.name,
            })),
          ]}
          onValueChange={setDefaultResponderId}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("chatPage.replySettings.defaultHint")}
        </p>
      </div>
      <div>
        <FieldLabel id="reply-maximum">
          {t("chatPage.replySettings.maximum")}
        </FieldLabel>
        <Select
          id="reply-maximum"
          ariaLabel={t("chatPage.replySettings.maximum")}
          value={String(mode === "decision" ? 1 : maximumResponders)}
          disabled={isDisabled || mode === "decision"}
          options={MAXIMUM_CHOICES.map((count) => ({
            value: String(count),
            label: String(count),
          }))}
          onValueChange={(count) => setMaximumResponders(Number(count))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("chatPage.replySettings.modelHint")}
      </p>
      {settings.canManage ? (
        <Button type="submit" size="sm" disabled={isPending}>
          {t("chatPage.replySettings.save")}
        </Button>
      ) : (
        <p role="note" className="text-sm text-muted-foreground">
          {t("chatPage.replySettings.readOnly")}
        </p>
      )}
    </form>
  );
}

function ReplySettingsBody({
  group,
  settings,
  fetchers,
}: {
  readonly group: VirtualGroup;
  readonly settings: ConversationReplySettingsView | null;
  /** `reader` loads the settings when the dialog opens, `writer` saves them. */
  readonly fetchers: {
    readonly reader: ReturnType<typeof useFetcher>;
    readonly writer: ReturnType<typeof useFetcher>;
  };
}): React.ReactElement {
  const { t } = useTranslation();
  const { reader, writer } = fetchers;
  const isPending = writer.state !== "idle";
  if (settings === null)
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {reader.state === "idle"
          ? t("chatPage.replySettings.failed")
          : t("chatPage.replySettings.loading")}
      </p>
    );
  function handleSave(draft: DraftSettings): void {
    const formData = new FormData();
    formData.set("intent", "save-reply-settings");
    formData.set("conversationId", group.id);
    formData.set("mode", draft.mode);
    formData.set("defaultResponderId", draft.defaultResponderId);
    formData.set("maximumResponders", String(draft.maximumResponders));
    void writer.submit(formData, { method: "post" });
  }
  const isSaved =
    !isPending &&
    isReplySettingsAnswer(writer.data) &&
    writer.data.intent === "save-reply-settings" &&
    writer.data.ok;
  return (
    <>
      <ReplySettingsForm
        key={`${settings.mode}:${settings.defaultResponderId ?? ""}:${String(settings.maximumResponders)}`}
        settings={settings}
        isPending={isPending}
        onSave={handleSave}
      />
      {isSaved ? (
        <p role="status" className="mt-3 text-sm text-success">
          {t("chatPage.replySettings.saved")}
        </p>
      ) : null}
      {isReplySettingsAnswer(writer.data) && !writer.data.ok && !isPending ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t("chatPage.replySettings.saveFailed")}
        </p>
      ) : null}
    </>
  );
}

/**
 * The setting "Wer antwortet?" of a group (PAGE-317): how a message without an
 * @ is answered, the default responder and the most answering agents.
 *
 * @remarks
 * Every member reads it; only the one who manages the group changes it, which
 * the server checks again. The model is not chosen here: the decision model of
 * the instance applies, which is set in Settings → Agents.
 */
export function ChatPageReplySettings({
  group,
}: {
  readonly group: VirtualGroup;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const reader = useFetcher();
  const writer = useFetcher();
  const settings =
    readSettings(writer.data, group.id) ?? readSettings(reader.data, group.id);

  function handleOpen(): void {
    setIsOpen(true);
    const formData = new FormData();
    formData.set("intent", "reply-settings");
    formData.set("conversationId", group.id);
    void reader.submit(formData, { method: "post" });
  }

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={handleOpen}
        size="sm"
        type="button"
        variant="outline"
      >
        <MessageCircleQuestionMark aria-hidden="true" className="size-3.5" />
        {t("chatPage.replySettings.open")}
      </Button>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogContent size="md">
          <DialogTitle className="text-lg font-semibold">
            {t("chatPage.replySettings.title", { name: group.name })}
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("chatPage.replySettings.description")}
          </DialogDescription>
          <ReplySettingsBody
            group={group}
            settings={settings}
            fetchers={{ reader, writer }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
