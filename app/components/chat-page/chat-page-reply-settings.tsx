import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";

import { ReplyAnswersTab } from "./reply-settings/reply-answers-tab";
import { ReplyDecisionsTab } from "./reply-settings/reply-decisions-tab";
import { useReplySettings } from "./reply-settings/use-reply-settings";

import type { VirtualGroup } from "@/definition/VirtualChat";

/** The tabs of the popup in their order. */
const TABS = ["answers", "decisions"] as const;

type ReplySettingsTab = (typeof TABS)[number];

function isTab(value: string): value is ReplySettingsTab {
  return TABS.some((tab) => tab === value);
}

/** The body of the "Antworten" tab, or why it is not there yet. */
function AnswersBody({
  state,
}: {
  readonly state: ReturnType<typeof useReplySettings>;
}): React.ReactElement {
  const { t } = useTranslation();
  const { settings } = state;
  if (settings === null)
    return (
      <p className="px-6 py-5 text-sm text-muted-foreground">
        {state.isLoading
          ? t("chatPage.replySettings.loading")
          : t("chatPage.replySettings.failed")}
      </p>
    );
  return (
    <ReplyAnswersTab
      // The form restarts from what the server stored, so a saved change shows as stored.
      key={`${settings.mode}:${JSON.stringify(settings.rules)}:${String(settings.isDefault)}:${String(settings.automaticRepliesPerOrigin)}`}
      settings={settings}
      isSaving={state.isSaving}
      isSaved={state.isSaved}
      isSaveFailed={state.isSaveFailed}
      onSave={state.save}
    />
  );
}

/**
 * The popup "Wer antwortet?" of a group (PAGE-317, PAGE-379), centered like
 * the ticket view and opened from the group menu in the head of the chat.
 *
 * @remarks
 * Its tab "Antworten" sets the mode "Nur @" or "@ + Decision", the thresholds
 * and the most answering agents of the group, and names the decision model of
 * the instance; its tab "Letzte Entscheidungen" lists what was decided about
 * the latest messages. Every member reads it; only the one who manages the
 * group changes it, which the server checks again. Both are read whenever the
 * popup opens.
 */
export function ChatPageReplySettings({
  group,
  isOpen,
  onOpenChange,
}: {
  readonly group: VirtualGroup;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ReplySettingsTab>("answers");
  const state = useReplySettings(group.id, isOpen);
  const tabs = TABS.map((value) => ({
    value,
    label: t(`chatPage.replySettings.tabs.${value}`),
  }));

  function handleTabChange(value: string): void {
    if (isTab(value)) setTab(value);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-[min(56rem,94vw)] p-0">
        <header className="flex items-start gap-4 px-6 pt-6">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <DialogTitle className="truncate text-xl font-semibold">
              {t("chatPage.replySettings.title", { name: group.name })}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t("chatPage.replySettings.description")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              aria-label={t("chatPage.replySettings.close")}
              size="icon-sm"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </DialogClose>
        </header>
        <Tabs
          ariaLabel={t("chatPage.replySettings.tabsLabel")}
          className="mt-4"
          listClassName="mx-6"
          onValueChange={handleTabChange}
          tabs={tabs}
          value={tab}
        >
          <TabsContent className="mt-4 border-t border-border" value="answers">
            <AnswersBody state={state} />
          </TabsContent>
          <TabsContent
            className="mt-4 border-t border-border"
            value="decisions"
          >
            <ReplyDecisionsTab decisions={state.decisions} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
