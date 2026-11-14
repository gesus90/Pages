import { Bot, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { ParticipantAvatar } from "./chat-page-avatar";
import { AgentSessionStatus } from "./chat-page-agent-status";
import { ChatPageAgentMenu, useAgentMenuState } from "./chat-page-agent-menu";

import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { AgentMenuOptions, AgentMenuState } from "./chat-page-agent-menu";

interface AgentTriggerProps {
  readonly agent: VirtualParticipant;
  readonly brief: AgentChatSessionBrief | undefined;
  readonly options: AgentMenuOptions;
}

/**
 * An agent in the member chips of a group: avatar, name and what its session
 * does in this chat. A click or a right click opens the menu of the agent.
 */
export function ChatPageAgentChip({
  agent,
  brief,
  options,
}: AgentTriggerProps): React.ReactElement {
  const { t } = useTranslation();
  const state = useAgentMenuState();
  return (
    <li className="inline-flex items-center gap-1.5">
      <ChatPageAgentMenu
        agent={agent}
        brief={brief}
        options={options}
        state={state}
      >
        <button
          className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pr-2.5 pl-1 text-[13px] text-foreground shadow-xs hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none data-[state=open]:ring-2 data-[state=open]:ring-primary"
          onContextMenu={state.openFromContextMenu}
          title={t("chatPage.agentMenu.hint")}
          type="button"
        >
          <ParticipantAvatar participant={agent} size={22} />
          {agent.name}
          <AgentSessionStatus brief={brief} />
        </button>
      </ChatPageAgentMenu>
    </li>
  );
}

/**
 * The button "Agent" in the head of the direct chat with an agent, which
 * opens the same menu as the chip of an agent in a group.
 *
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
        size="sm"
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
