import { Bot, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ModelBadge } from "@/app/components/agents/badges/model-badge";
import { openCodeSourceName } from "@/app/components/agents/model-picker/model-catalog";
import { cn } from "@/app/lib/cn";
import { shortModelName } from "@/definition/AgentChatControl";
import { modelBadgeVendor } from "@/definition/AgentModelIdentity";

import { AccessMark } from "./chat-page-access-badge";
import { ParticipantAvatar } from "./chat-page-avatar";
import { AgentSessionStatus } from "./chat-page-agent-status";
import { ChatPageAgentMenu, useAgentMenuState } from "./chat-page-agent-menu";
import { ChatPageContextRing } from "./chat-page-context-rings";
import { PRIMARY_CHIP_CLASS } from "./chat-page-primary-chip";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { AgentMenuOptions, AgentMenuState } from "./chat-page-agent-menu";

interface AgentTriggerProps {
  readonly agent: VirtualParticipant;
  readonly brief: AgentChatSessionBrief | undefined;
  readonly options: AgentMenuOptions;
}

/**
 * The short name of the model of an agent, such as "Opus", where the chat
 * deviates from the agent's own model; nothing otherwise. A Claude Code,
 * Codex, Antigravity or OpenCode model, or a model of a direct Z.AI
 * connection, shows the shared model badge of its vendor or tool instead.
 * `className` changes its size, such as to the 32 px of the direct chat's
 * head.
 */
export function ChatModelBadge({
  model,
  className,
}: {
  readonly model: AgentChatModelLabel | undefined;
  readonly className?: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (model?.isOverride !== true) return null;
  const vendor = modelBadgeVendor(model.provider);
  if (vendor)
    return (
      <span
        className={className}
        title={t("chatPage.modelChoice.badgeHint", { model: model.name })}
      >
        <ModelBadge
          vendor={vendor}
          name={model.name}
          source={openCodeSourceName(model.provider, model.modelId, t)}
        />
      </span>
    );
  return (
    <span
      className={cn(PRIMARY_CHIP_CLASS, className)}
      title={t("chatPage.modelChoice.badgeHint", { model: model.name })}
    >
      {shortModelName(model.name)}
    </span>
  );
}

/**
 * An agent in the member chips of a group, 32 px high: avatar, name, the
 * sign "!" of YOLO access, the badge of what its session does in this chat
 * and its context ring. A click or a right click on the chip opens the menu
 * of the agent; the ring opens its own details.
 */
export function ChatPageAgentChip({
  agent,
  brief,
  options,
  chatName,
}: AgentTriggerProps & {
  /** The name of the group, for the details of the context ring. */
  readonly chatName: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const state = useAgentMenuState();
  return (
    <li className="inline-flex h-8 items-center gap-1 rounded-full bg-surface pr-1 shadow-xs">
      <ChatPageAgentMenu
        agent={agent}
        brief={brief}
        options={options}
        state={state}
      >
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-full py-1 pr-1 pl-1 text-[13px] whitespace-nowrap text-foreground hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none data-[state=open]:ring-2 data-[state=open]:ring-primary"
          onContextMenu={state.openFromContextMenu}
          title={t("chatPage.agentMenu.hint")}
          type="button"
        >
          <ParticipantAvatar participant={agent} size={22} />
          {agent.name}
          <AccessMark participant={agent} />
          <ChatModelBadge model={options.control?.model} />
          <AgentSessionStatus brief={brief} size="chip" />
        </button>
      </ChatPageAgentMenu>
      <ChatPageContextRing
        entry={{ agent, brief, model: options.control?.model }}
        chatName={chatName}
        place="chip"
      />
    </li>
  );
}

/**
 * The button "Agent" in the head of the direct chat with an agent, which
 * opens the same menu as the chip of an agent in a group.
 * @remarks
 * The caller owns the open state of the menu, so that a right click on the
 * title of the head opens it, too.
 */
export function ChatPageAgentButton({
  agent,
  brief,
  options,
  state,
}: AgentTriggerProps & {
  readonly state: AgentMenuState;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ChatPageAgentMenu
      agent={agent}
      brief={brief}
      options={options}
      state={state}
    >
      <Button
        aria-label={t("chatPage.agentMenu.triggerLabel")}
        onContextMenu={state.openFromContextMenu}
        size="xs"
        title={t("chatPage.agentMenu.hint")}
        variant="outline"
      >
        <Bot aria-hidden="true" className="size-3.5" />
        {t("chatPage.agentMenu.trigger")}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </Button>
    </ChatPageAgentMenu>
  );
}
