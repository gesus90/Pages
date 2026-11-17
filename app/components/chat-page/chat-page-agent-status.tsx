import { Check, Loader, Moon, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { LucideIcon } from "lucide-react";
import type {
  AgentChatSessionBrief,
  AgentChatSessionState,
} from "@/definition/AgentChatSession";

/** The size of the badge: 32 px in the head of a direct chat, 22 px on the chip of an agent in a group. */
type AgentSessionStatusSize = "header" | "chip";

/** Color, background and symbol of each state. */
const STATE_LOOK: Readonly<
  Record<AgentChatSessionState, { tone: string; icon: LucideIcon }>
> = {
  working: {
    tone: "bg-status-active-subtle text-status-active",
    icon: Loader,
  },
  ready: { tone: "bg-success-subtle text-success", icon: Check },
  resting: { tone: "bg-muted text-muted-foreground", icon: Moon },
  restart_needed: {
    tone: "bg-destructive-subtle text-destructive",
    icon: RotateCw,
  },
};

/** Height, padding, text and symbol size of the badge per size. */
const SIZE_LOOK: Readonly<
  Record<AgentSessionStatusSize, { badge: string; icon: string }>
> = {
  header: { badge: "h-8 gap-1.5 px-3 text-xs", icon: "size-3.5" },
  chip: { badge: "h-[22px] gap-1 px-2 text-[11px]", icon: "size-3" },
};

/**
 * What an agent does in this chat, from its session, as a colored badge
 * with a symbol: "arbeitet", "bereit", "ruhend" or "Neustart nötig".
 * @remarks
 * The symbol of a working agent turns, unless the person asked for reduced
 * motion. Messages waiting for their turn are named in the status line of
 * the input, not here.
 * @returns The badge, or `null` while the agent has no session in the chat.
 */
export function AgentSessionStatus({
  brief,
  size = "header",
}: {
  readonly brief: AgentChatSessionBrief | undefined;
  readonly size?: AgentSessionStatusSize;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (brief === undefined) return null;
  const look = STATE_LOOK[brief.state];
  const Icon = look.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap",
        SIZE_LOOK[size].badge,
        look.tone,
      )}
      data-agent-state={brief.state}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "shrink-0",
          SIZE_LOOK[size].icon,
          brief.state === "working" && "motion-safe:animate-spin",
        )}
      />
      {t(`chatPage.agentStatus.${brief.state}`)}
    </span>
  );
}
