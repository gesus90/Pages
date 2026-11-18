import { useTranslation } from "react-i18next";

import { ToolMark } from "@/app/components/agents/model-picker/tool-mark";
import { cn } from "@/app/lib/cn";

/** How a state reads in the header: running work in the primary color, a failure in red, a success in green. */
export type StateTone = "active" | "success" | "danger" | "neutral";

/** The state of the node as the header shows it. */
export interface HeaderState {
  /** The translated words, such as „Turn läuft“. */
  readonly label: string;
  readonly tone: StateTone;
}

/** 24 px high with a 1 px border and a 7 px radius, like every agent badge. */
const BADGE_CLASS =
  "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-[7px] border text-[11px] leading-none font-semibold";

const TONES: Readonly<
  Record<StateTone, { readonly badge: string; readonly dot: string }>
> = {
  active: {
    badge: "border-primary bg-primary-subtle text-status-active",
    dot: "bg-primary",
  },
  success: {
    badge: "border-success bg-success-subtle text-success",
    dot: "bg-success-dot",
  },
  danger: {
    badge: "border-destructive bg-destructive-subtle text-destructive",
    dot: "bg-destructive",
  },
  neutral: {
    badge: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

/**
 * The provider of a Claude Code node: the unchanged tile, the tool and the account, outlined in Claude's color.
 * @remarks
 * The 18 px tile with a 5 px radius sits 2 px from the top, bottom and left
 * edge of the 24 px badge, so the corners run parallel; a vertical rule
 * separates „Claude Code“ from „Claude-Abo“.
 */
export function ClaudeProviderBadge(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      data-provider-badge="claude_code"
      className={cn(
        BADGE_CLASS,
        "border-claude bg-surface py-[2px] pr-2 pl-[2px]",
      )}
    >
      <ToolMark mark="claude" className="size-[18px] rounded-[5px]" />
      <span className="shrink-0 text-foreground">
        {t("plans.session.runner.claude_code")}
      </span>
      <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
      <span className="min-w-0 truncate text-foreground">
        {t("plans.modelPicker.access.claude_code")}
      </span>
    </span>
  );
}

/**
 * The state of the node as a badge with a 6 px dot, such as „Turn läuft“.
 * @remarks
 * Running work stands in the primary color, the same 24 px high badge with
 * a 7 px radius and a 1 px border as the provider.
 */
export function StateBadge({
  state,
}: {
  readonly state: HeaderState;
}): React.ReactElement {
  const tone = TONES[state.tone];
  return (
    <span
      data-state-badge={state.tone}
      className={cn(BADGE_CLASS, "px-2", tone.badge)}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", tone.dot)}
      />
      <span className="min-w-0 truncate">{state.label}</span>
    </span>
  );
}

/** A further note of the header, such as a manual intervention, in the same badge size. */
export function NoteBadge({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className={cn(BADGE_CLASS, "px-2", TONES.neutral.badge)}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
