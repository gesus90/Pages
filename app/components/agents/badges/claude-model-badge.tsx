import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ToolMark } from "../model-picker/tool-mark";

import type { AgentValueStatus } from "@/definition/AgentModelIdentity";

/** The vendor of every Claude model; a brand name, never translated. */
const CLAUDE_VENDOR = "Anthropic";

interface ClaudeModelBadgeProps {
  /** The catalog name, such as `Haiku 5.5`. */
  readonly name: string;
  readonly status?: AgentValueStatus;
  readonly className?: string;
}

/**
 * The model badge of Claude: the unchanged Claude tile, the vendor and the
 * catalog name, outlined in Claude's orange.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius; the 18 px tile with a 5 px
 * radius sits 2 px from the top, bottom and left edge, so the corners run
 * parallel. A long name is cut with an ellipsis while the tile and the vendor
 * stay whole. A requested model the adapter has not confirmed yet has a
 * dashed border, so it never reads as confirmed.
 */
export function ClaudeModelBadge({
  name,
  status = "configured",
  className,
}: ClaudeModelBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const statusText = t(`agentBadges.model.status.${status}`);
  return (
    <span
      title={`${CLAUDE_VENDOR} ${name} · ${statusText}`}
      aria-label={t("agentBadges.model.label", {
        vendor: CLAUDE_VENDOR,
        name,
        status: statusText,
      })}
      data-model-badge="claude"
      data-value-status={status}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 shrink items-center gap-[7px] rounded-[7px] border border-claude bg-surface py-[2px] pr-[9px] pl-[2px] text-[11px] leading-none",
        status === "requested" && "border-dashed",
        className,
      )}
    >
      <ToolMark mark="claude" className="size-[18px] rounded-[5px]" />
      <span className="shrink-0 text-muted-foreground">{CLAUDE_VENDOR}</span>
      <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
      <span className="min-w-0 truncate font-semibold text-foreground">
        {name}
      </span>
    </span>
  );
}
