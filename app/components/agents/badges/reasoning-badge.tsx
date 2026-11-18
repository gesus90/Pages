import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { isReasoningBadgeLevel } from "@/definition/AgentModelIdentity";

import {
  REASONING_LEVEL_CLASSES,
  ReasoningTile,
  reasoningSignLevel,
} from "./reasoning-sign";

import type { AgentValueStatus } from "@/definition/AgentModelIdentity";

interface ReasoningBadgeProps {
  /** The reasoning level as the model names it, such as `high`. */
  readonly level: string;
  readonly status?: AgentValueStatus;
  /** Whether the model offers the level; `false` adds a warning, `null` says nothing. */
  readonly isOffered?: boolean | null;
  readonly className?: string;
}

/**
 * The reasoning level as a badge of its own: the level's tile with its sign
 * and the word in the level's color.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius; the 18 px tile with a
 * 5 px radius and a 12 px sign sits 2 px from the top, bottom and left edge,
 * as in the model badge, 6 px before the word and 8 px of padding on the
 * right. Another level changes only sign, color and word, never the height
 * or the border. The sign and the word always stand beside the color, so the
 * color alone carries no meaning. A level the badge does not know keeps its
 * raw name with the grey style and the ring of `none`. Showing a level never
 * widens what a model offers: a level the model does not offer is marked as
 * such. The 1 px solid border takes the dot's color of the level in either
 * theme. Whether the adapter confirmed the
 * level stands in the tooltip and the accessible name, never in the border.
 */
export function ReasoningBadge({
  level,
  status = "configured",
  isOffered = null,
  className,
}: ReasoningBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const isKnown = isReasoningBadgeLevel(level);
  const signLevel = reasoningSignLevel(level);
  const word = isKnown ? t(`agentBadges.reasoning.level.${level}`) : level;
  const notes = [
    t(`agentBadges.model.status.${status}`),
    ...(isOffered === false ? [t("agentBadges.reasoning.notOffered")] : []),
  ].join(" · ");
  return (
    <span
      title={`${word} · ${notes}`}
      aria-label={t("agentBadges.reasoning.label", { level: word, notes })}
      data-reasoning-badge={isKnown ? level : "unknown"}
      data-value-status={status}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[7px] border py-[2px] pr-2 pl-[2px] text-[11px] leading-none font-semibold whitespace-nowrap",
        REASONING_LEVEL_CLASSES[signLevel].badge,
        className,
      )}
    >
      <ReasoningTile
        level={signLevel}
        className="size-[18px] rounded-[5px]"
        signClassName="size-3"
      />
      <span className="min-w-0 truncate">{word}</span>
      {isOffered === false ? (
        <span aria-hidden="true" className="shrink-0">
          ⚠
        </span>
      ) : null}
    </span>
  );
}
