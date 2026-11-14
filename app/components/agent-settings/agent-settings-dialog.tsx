import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";

import { AgentDreamingTab } from "./agent-dreaming-tab";
import { AgentLessonsTab } from "./agent-lessons-tab";
import { AgentLogbookTab } from "./agent-logbook-tab";
import { AgentSessionsTab } from "./agent-sessions-tab";
import {
  AGENT_SETTINGS_TABS,
  readAvailableAgentSettingsTab,
  resolveAgentSettingsTab,
} from "./agent-settings-tabs";
import { useAgentSessions } from "./use-agent-sessions";

import type {
  AgentSettingsCurrentChat,
  AgentSettingsIdentity,
} from "./agent-settings-types";
import type { AgentSettingsTab } from "./agent-settings-tabs";

interface AgentSettingsDialogProps {
  /** The agent whose settings to show; `null` keeps the popup closed. */
  readonly agentId: string | null;
  /** The tab to open in; one that does not work opens "Sitzungen". */
  readonly initialTab?: AgentSettingsTab;
  /** The chat the popup was opened from; its session stands out in the table. */
  readonly currentChat?: AgentSettingsCurrentChat;
  /** What the head shows before the sessions arrive: name, line and avatar. */
  readonly identity?: AgentSettingsIdentity;
  readonly onClose: () => void;
}

/** Avatar, title, subtitle and the close button of the popup. */
function AgentSettingsHeader({
  name,
  identity,
}: {
  readonly name: string;
  readonly identity: AgentSettingsIdentity | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const subtitle = identity?.subtitle ?? "";
  const imageUrl = identity?.avatarImageUrl ?? null;
  return (
    <header className="flex items-start gap-4 px-6 pt-6">
      <UserAvatar
        avatarColor={identity?.color ?? null}
        avatarImageUrl={imageUrl}
        avatarType={imageUrl === null ? "initials" : "image"}
        name={name}
        size="lg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <DialogTitle className="truncate text-xl font-semibold">
          {name === ""
            ? t("agentSettings.titleUnknown")
            : t("agentSettings.title", { name })}
        </DialogTitle>
        <DialogDescription
          className={
            subtitle === ""
              ? "sr-only"
              : "truncate text-sm text-muted-foreground"
          }
        >
          {subtitle === "" ? t("agentSettings.description") : subtitle}
        </DialogDescription>
      </div>
      <DialogClose asChild>
        <Button
          aria-label={t("agentSettings.close")}
          size="icon-sm"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </DialogClose>
    </header>
  );
}

/** The content of the popup while it is open; closing it forgets everything it read. */
function AgentSettingsBody({
  agentId,
  initialTab,
  currentChat,
  identity,
  onClose,
}: Omit<AgentSettingsDialogProps, "agentId"> & {
  readonly agentId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState(() => resolveAgentSettingsTab(initialTab));
  const sessions = useAgentSessions(agentId);
  const name = identity?.name ?? sessions.overview?.agentName ?? "";
  const tabs = AGENT_SETTINGS_TABS.map((entry) => ({
    value: entry.value,
    label: t(`agentSettings.tabs.${entry.value}`),
    isDisabled: !entry.isAvailable,
    title: entry.isAvailable ? undefined : t("agentSettings.soon"),
  }));

  function handleTabChange(value: string): void {
    const next = readAvailableAgentSettingsTab(value);
    if (next !== null) setTab(next);
  }

  return (
    <div className="flex flex-col">
      <AgentSettingsHeader name={name} identity={identity} />
      <Tabs
        ariaLabel={t("agentSettings.tabsLabel")}
        className="mt-4"
        listClassName="mx-6"
        onValueChange={handleTabChange}
        tabs={tabs}
        value={tab}
      >
        {tabs.some((entry) => entry.isDisabled) ? (
          <p className="mx-6 mt-2 text-xs text-muted-foreground">
            {t("agentSettings.soonNote")}
          </p>
        ) : null}
        <TabsContent className="mt-4 border-t border-border" value="sessions">
          <AgentSessionsTab
            sessions={sessions}
            currentChat={currentChat}
            onClose={onClose}
          />
        </TabsContent>
        <TabsContent className="mt-4 border-t border-border" value="logbook">
          <AgentLogbookTab agentId={agentId} onClose={onClose} />
        </TabsContent>
        <TabsContent className="mt-4 border-t border-border" value="dreaming">
          <AgentDreamingTab
            agentId={agentId}
            onClose={onClose}
            onOpenLessons={() => setTab("lessons")}
          />
        </TabsContent>
        <TabsContent className="mt-4 border-t border-border" value="lessons">
          <AgentLessonsTab agentId={agentId} onClose={onClose} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * The popup "Agent-Einstellungen" of one agent (PAGE-376), the same from the
 * chat and from the user administration.
 *
 * @remarks
 * Its tabs are Sitzungen, Lagebuch (PAGE-377), Dreaming and Lektionen &
 * Rezepte (PAGE-378). A tab whose function is missing shows as switched off.
 * The popup reads the sessions of the agent when it opens and the Lagebuch,
 * Dreaming or lessons when their tab opens, and keeps no state after it
 * closes.
 */
export function AgentSettingsDialog({
  agentId,
  initialTab,
  currentChat,
  identity,
  onClose,
}: AgentSettingsDialogProps): React.ReactElement {
  return (
    <Dialog
      open={agentId !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="w-[min(72rem,94vw)] p-0">
        {agentId === null ? null : (
          <AgentSettingsBody
            key={agentId}
            agentId={agentId}
            initialTab={initialTab}
            currentChat={currentChat}
            identity={identity}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
