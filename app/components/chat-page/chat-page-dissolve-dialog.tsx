import { useTranslation } from "react-i18next";

import { clampContextPercent } from "@/app/components/agent-settings/agent-session-display";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { ParticipantAvatar } from "./chat-page-avatar";
import { useAgentControl } from "./use-agent-control";

import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

interface ChatPageDissolveDialogProps {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** One agent whose session the dissolution closes, with its model, context and state. */
function AgentSessionRow({
  agent,
  group,
}: {
  readonly agent: VirtualParticipant;
  readonly group: VirtualGroup;
}): React.ReactElement {
  const { t } = useTranslation();
  const brief = group.agentSessions?.find(
    (entry) => entry.agentId === agent.id,
  );
  const model = group.agentModels?.[agent.id];
  const percent = clampContextPercent(brief?.contextPercent ?? null);
  return (
    <li className="flex flex-wrap items-center gap-2 py-1 text-sm">
      <ParticipantAvatar participant={agent} size={22} />
      <span className="min-w-24 font-medium">{agent.name}</span>
      <span className="min-w-32 text-xs text-muted-foreground">
        {model?.name ?? ""}
        {model?.isOverride === true
          ? ` · ${t("chatPage.dissolve.onlyHere")}`
          : ""}
      </span>
      <span
        aria-hidden="true"
        className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full bg-primary"
          style={{ width: `${percent ?? 0}%` }}
        />
      </span>
      <span className="text-xs text-muted-foreground">
        {percent === null ? "–" : `${percent} %`}
        {" · "}
        {brief === undefined
          ? t("chatPage.dissolve.noSession")
          : t(`agentSessions.state.${brief.state}`)}
      </span>
    </li>
  );
}

/**
 * The question before the creator dissolves a group (PAGE-380): which
 * sessions of agents close, that the history is deleted for good, and that
 * the memory and dreaming of the agents stay.
 */
export function ChatPageDissolveDialog({
  group,
  members,
  isOpen,
  onOpenChange,
}: ChatPageDissolveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const request = useAgentControl();
  const agents = members.filter((member) => member.kind === "agent");

  async function handleDissolve(): Promise<void> {
    const response = await request.send({
      intent: "dissolve",
      groupId: group.id,
    });
    if (response?.ok === true) onOpenChange(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.dissolve.title", { name: group.name })}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("chatPage.dissolve.description", {
            count: group.memberIds.length + 1,
          })}
        </DialogDescription>
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive-subtle p-3">
          <p className="text-sm font-semibold">
            {agents.length === 0
              ? t("chatPage.dissolve.noAgents")
              : t("chatPage.dissolve.sessions")}
          </p>
          <ul className="mt-2">
            {agents.map((agent) => (
              <AgentSessionRow key={agent.id} agent={agent} group={group} />
            ))}
          </ul>
          <p className="mt-2 text-sm">{t("chatPage.dissolve.history")}</p>
        </div>
        <p className="mt-3 rounded-lg border border-success/30 bg-success-subtle p-3 text-sm">
          {t("chatPage.dissolve.kept")}
        </p>
        {request.failure === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t(`chatPage.control.failure.${request.failure}`)}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("chatPage.modelChoice.cancel")}
          </Button>
          <Button
            variant="destructive"
            isPending={request.isPending}
            onClick={() => void handleDissolve()}
          >
            {t("chatPage.dissolve.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
