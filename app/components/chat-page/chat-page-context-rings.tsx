import { useId } from "react";
import { useTranslation } from "react-i18next";

import { clampContextPercent } from "@/app/components/agent-settings/agent-session-display";
import { ContextRing } from "@/app/components/chat/chat-context-indicator";
import { useChatContextDetails } from "@/app/components/chat/use-chat-context-details";
import { cn } from "@/app/lib/cn";
import { AGENT_CHAT_SESSION_RESTART_DEFAULT_PERCENT } from "@/definition/AgentChatSession";

import { effortLabel } from "./chat-page-model-dialog";
import { PRIMARY_CHIP_CLASS } from "./chat-page-primary-chip";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualParticipant } from "@/definition/VirtualChat";

/** One agent of the chat with its session and model there. */
export interface ContextRingEntry {
  readonly agent: VirtualParticipant;
  readonly brief: AgentChatSessionBrief | undefined;
  readonly model: AgentChatModelLabel | undefined;
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
        <span className={PRIMARY_CHIP_CLASS}>
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

/** Where a ring stands: the 32 px field of the direct chat's head, or the chip of an agent in a group. */
type ContextRingPlace = "header" | "chip";

/**
 * The field of the ring's button, the size of the doughnut and the edge its
 * details align with, per place: the head's ring sits at the right, the
 * chips start at the left.
 */
const RING_PLACE: Readonly<
  Record<ContextRingPlace, { button: string; ring: string; details: string }>
> = {
  header: { button: "size-8", ring: "size-7", details: "right-0" },
  chip: { button: "size-6", ring: "size-6", details: "left-0" },
};

/**
 * The context ring of one agent, beside its state: how full the context of
 * its current session in this chat is.
 * @remarks
 * It is the ring of Pica's chat with the initial of the agent. Its details
 * open below it on hover, focus and tap and name the model, the fill, the
 * restart threshold and the state of the session; it pulses while the
 * session is being compacted.
 */
export function ChatPageContextRing({
  entry,
  chatName,
  place,
}: {
  readonly entry: ContextRingEntry;
  readonly chatName: string;
  readonly place: ContextRingPlace;
}): React.ReactElement {
  const { t } = useTranslation();
  const tooltipId = useId();
  const details = useChatContextDetails();
  const percent = clampContextPercent(entry.brief?.contextPercent ?? null);
  const isCompacting = entry.brief?.state === "restart_needed";
  const size = RING_PLACE[place];
  return (
    <span
      ref={details.container}
      className="relative inline-flex shrink-0"
      data-context-ring=""
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
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          size.button,
        )}
        onFocus={details.open}
        onBlur={details.close}
        onClick={details.toggle}
      >
        <ContextRing
          percent={percent}
          label={entry.agent.name.slice(0, 1).toLocaleUpperCase()}
          isBusy={isCompacting}
          className={size.ring}
        />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!details.isOpen}
        className={cn("absolute top-full z-50 w-64 pt-2", size.details)}
      >
        <span className="block rounded-lg bg-surface p-3 text-xs leading-relaxed text-foreground shadow-panel ring-1 ring-border">
          <RingDetails entry={entry} chatName={chatName} percent={percent} />
        </span>
      </span>
    </span>
  );
}
