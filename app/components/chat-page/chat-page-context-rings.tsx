import { useId } from "react";
import { useTranslation } from "react-i18next";

import { clampContextPercent } from "@/app/components/agent-settings/agent-session-display";
import { ContextRing } from "@/app/components/chat/chat-context-indicator";
import { useChatContextDetails } from "@/app/components/chat/use-chat-context-details";
import { AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT } from "@/definition/AgentChatSession";

import { effortLabel } from "./chat-page-model-dialog";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";
import type { OpenedConversation } from "./use-chat-page";

/** One agent of the chat with its session and model there. */
export interface ContextRingEntry {
  readonly agent: VirtualParticipant;
  readonly brief: AgentChatSessionBrief | undefined;
  readonly model: AgentChatModelLabel | undefined;
}

/**
 * The agents of the opened chat whose context the foot shows: the agent of a
 * direct chat, or every agent of a group.
 * @param opened - The opened conversation.
 * @returns No entry for a conversation with a person.
 */
export function contextRingEntries(
  opened: OpenedConversation,
): ContextRingEntry[] {
  if (opened.kind === "participant") {
    const { participant } = opened;
    if (participant.kind !== "agent") return [];
    return [
      {
        agent: participant,
        brief: participant.session,
        model: participant.chatModel,
      },
    ];
  }
  const { group, members } = opened;
  return members
    .filter((member) => member.kind === "agent")
    .map((agent) => ({
      agent,
      brief: group.agentSessions?.find((entry) => entry.agentId === agent.id),
      model: group.agentModels?.[agent.id],
    }));
}

/** "124k" or "1.2M", as the context ring of Pica names token counts. */
function compact(amount: number): string {
  if (amount >= 1_000_000)
    return `${String(Math.round(amount / 100_000) / 10)}M`;
  if (amount >= 1_000) return `${String(Math.round(amount / 1_000))}k`;
  return String(amount);
}

/** Model name and optional reasoning effort and per-chat override badge. */
function RingModelLine({
  model,
}: {
  readonly model: AgentChatModelLabel | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!model) return null;
  const label =
    model.reasoningEffort === null
      ? model.name
      : `${model.name} · ${effortLabel(t, model.reasoningEffort)}`;
  return (
    <span className="mt-1 flex items-center gap-1.5">
      {label}
      {model.isOverride ? (
        <span className="rounded-full bg-primary-subtle px-1.5 text-[11px] text-primary">
          {t("chatPage.contextRing.onlyHere")}
        </span>
      ) : null}
    </span>
  );
}

function ringFillText(
  t: (key: string, options?: Record<string, unknown>) => string,
  percent: number | null,
  used: number | null,
  size: number | null,
): string {
  if (percent === null) return t("chatPage.contextRing.unknown");
  return t("chatPage.contextRing.fill", {
    percent,
    used: used === null ? "–" : compact(used),
    size: size === null ? "–" : compact(size),
  });
}

/** The details of one ring: model, fill, restart threshold and state. */
function RingDetails({
  entry,
  chatName,
  percent,
}: {
  readonly entry: ContextRingEntry;
  readonly chatName: string;
  readonly percent: number | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { brief, model, agent } = entry;
  const used = brief?.contextUsed ?? null;
  const size = brief?.contextSize ?? model?.contextWindow ?? null;
  const stateLabel =
    brief === undefined
      ? t("chatPage.contextRing.noSession")
      : t(`agentSessions.state.${brief.state}`);
  return (
    <>
      <span className="block font-semibold">
        {t("chatPage.contextRing.title", { agent: agent.name, chat: chatName })}
      </span>
      <RingModelLine model={model} />
      <span className="mt-1 block">{ringFillText(t, percent, used, size)}</span>
      <span className="mt-1 block">
        {t("chatPage.contextRing.restart", {
          percent:
            brief?.restartPercent ?? AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT,
          state: stateLabel,
        })}
      </span>
    </>
  );
}

/** One ring with the initial of its agent and its details on hover, focus and tap. */
function AgentContextRing({
  entry,
  chatName,
}: {
  readonly entry: ContextRingEntry;
  readonly chatName: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const tooltipId = useId();
  const details = useChatContextDetails();
  const percent = clampContextPercent(entry.brief?.contextPercent ?? null);
  const isCompacting = entry.brief?.state === "restart_needed";
  return (
    <span
      ref={details.container}
      className="relative inline-flex shrink-0"
      onMouseEnter={details.handleMouseEnter}
      onMouseLeave={details.handlePointerLeave}
      onPointerEnter={details.handlePointerEnter}
      onPointerLeave={details.handlePointerLeave}
    >
      <button
        type="button"
        aria-describedby={tooltipId}
        aria-expanded={details.isOpen}
        aria-label={t("chatPage.contextRing.label", {
          agent: entry.agent.name,
          percent: percent ?? "–",
        })}
        className="inline-flex min-h-11 items-center rounded-lg px-0.5 text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary xl:min-h-9"
        onFocus={details.open}
        onBlur={details.close}
        onClick={details.toggle}
      >
        <ContextRing
          percent={percent}
          label={entry.agent.name.slice(0, 1).toLocaleUpperCase()}
          isBusy={isCompacting}
        />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!details.isOpen}
        className="absolute right-0 bottom-full z-50 w-64 pb-2"
      >
        <span className="block rounded-lg bg-surface p-3 text-xs leading-relaxed text-foreground shadow-panel ring-1 ring-border">
          <RingDetails entry={entry} chatName={chatName} percent={percent} />
        </span>
      </span>
    </span>
  );
}

/**
 * The context rings at the foot of the input field: how full the
 * context of the current session is, one ring in a direct chat with an agent
 * and one per agent in a group. It is the ring of Pica's chat; its details
 * name the model, the fill, the restart threshold and the state of the
 * session, and it pulses while the session is being compacted.
 */
export function ChatPageContextRings({
  opened,
  chatName,
}: {
  readonly opened: OpenedConversation;
  readonly chatName: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const entries = contextRingEntries(opened);
  if (entries.length === 0) return null;
  return (
    <span
      aria-label={t("chatPage.contextRing.group")}
      className="flex flex-wrap items-center justify-end gap-1.5"
      role="group"
    >
      {entries.map((entry) => (
        <AgentContextRing
          key={entry.agent.id}
          entry={entry}
          chatName={chatName}
        />
      ))}
    </span>
  );
}
