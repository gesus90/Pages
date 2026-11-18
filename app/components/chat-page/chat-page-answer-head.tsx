import { useTranslation } from "react-i18next";

import { AgentModelBadges } from "@/app/components/agents/badges/agent-model-badges";
import { cn } from "@/app/lib/cn";

import { participantColors } from "./chat-page-colors";
import { PRIMARY_CHIP_CLASS } from "./chat-page-primary-chip";
import { ChatAnswerDuration } from "./live/chat-answer-duration";

import type { AgentModelBadgeValues } from "@/app/components/agents/badges/agent-model-badges";
import type { VirtualParticipant } from "@/definition/VirtualChat";

/**
 * The frame of an answer with a head: a container of its own, with the
 * 36 px avatar in the first column and everything else 8 px beside it.
 * @remarks
 * From 520 px of width the head is one line of 24 px beside the avatar;
 * below, name and avatar form the first line and the badges a second line
 * from the left edge, 8 px below.
 */
export const ANSWER_FRAME_CLASS =
  "@container grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-2";

/** The avatar in the frame; with a head of one line it reaches into the next row. */
export function answerAvatarClass(hasHead: boolean): string {
  return cn(
    "col-start-1 row-start-1 shrink-0 rounded-full",
    hasHead && "@min-[520px]:row-end-3",
  );
}

/** The column of an answer's content, beside the avatar and below its head. */
export const ANSWER_CONTENT_CLASS =
  "col-start-2 flex min-w-0 flex-col items-start gap-2";

/**
 * The "live" hint of a running answer.
 * @remarks
 * It has the same shape beside every provider's badges: the orange chip of
 * the chat with a pulsing dot, still while reduced motion is preferred.
 */
function LiveBadge(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span data-live-badge="" className={cn(PRIMARY_CHIP_CLASS, "gap-1.5")}>
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
      />
      {t("chatPage.liveAnswer.live")}
    </span>
  );
}

interface AnswerHeadProps {
  readonly author: VirtualParticipant;
  /** The model of the answer; absent shows the name alone. */
  readonly model?: AgentModelBadgeValues;
  /** Whether the answer is being written, which adds the hint "live". */
  readonly isLive?: boolean;
  /** Whether the agent's job title follows the name, as in a stored answer. */
  readonly hasRole?: boolean;
  /** The elapsed time of a live answer, shown after its badges; absent hides it. */
  readonly durationMs?: number;
}

/**
 * Name, model, "Free", reasoning, "live" and the elapsed time above an answer,
 * in the frame of {@link ANSWER_FRAME_CLASS}.
 * @remarks
 * The badges keep the order model, "Free", reasoning, "live", the elapsed time,
 * 6 px apart and never wrap: only the model name is cut with an ellipsis, the
 * full name stands in its tooltip, and "Free", reasoning, "live" and the time
 * never shrink. Below 520 px of container width the model badge drops its grey
 * vendor word. A stored answer shows the same head without "live", so the head
 * keeps its height when the answer ends.
 */
export function AnswerHead({
  author,
  model,
  isLive = false,
  hasRole = false,
  durationMs,
}: AnswerHeadProps): React.ReactElement {
  const colors = participantColors(author.color);
  const hasBadges = model !== undefined || isLive || durationMs !== undefined;
  return (
    <div
      className="contents @min-[520px]:col-start-2 @min-[520px]:row-start-1 @min-[520px]:flex @min-[520px]:h-6 @min-[520px]:min-w-0 @min-[520px]:items-center @min-[520px]:gap-1.5"
      data-answer-head=""
    >
      <p className="col-start-2 row-start-1 flex h-9 min-w-0 items-center text-[13px] whitespace-nowrap @min-[520px]:h-6 @min-[520px]:max-w-[50%] @min-[520px]:shrink-0">
        <span
          className={cn(
            "min-w-0 truncate leading-5 font-semibold",
            colors.text.className,
          )}
          style={colors.text.style}
        >
          {author.name}
        </span>
        {hasRole && author.role !== "" ? (
          <span className="min-w-0 truncate text-muted-foreground">
            &nbsp;· {author.role}
          </span>
        ) : null}
      </p>
      {hasBadges ? (
        <div
          className="col-start-1 col-end-3 row-start-2 flex h-6 min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap @min-[520px]:flex-1"
          data-answer-badges=""
        >
          {model ? (
            <AgentModelBadges model={model} isCompactWhenNarrow />
          ) : null}
          {isLive ? <LiveBadge /> : null}
          {durationMs === undefined ? null : (
            <ChatAnswerDuration durationMs={durationMs} />
          )}
        </div>
      ) : null}
    </div>
  );
}
