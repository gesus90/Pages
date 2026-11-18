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
  "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-[7px] border text-[11px] leading-4 font-semibold";

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

/** What the provider badge of a runner shows: its tile, its outline and the keys of its two words. */
interface ProviderBadgeLook {
  /** The key of the tool mark, such as `claude` or `openai`. */
  readonly mark: string;
  /** The 1 px outline in the provider token, the same in the light and the dark palette. */
  readonly borderClass: string;
  readonly nameKey: string;
  readonly accountKey: string;
}

/** The runners with a provider badge of their own; any other runner keeps a plain label. */
const PROVIDER_BADGES: Readonly<Record<string, ProviderBadgeLook>> = {
  claude_code: {
    mark: "claude",
    borderClass: "border-claude",
    nameKey: "plans.session.runner.claude_code",
    accountKey: "plans.modelPicker.access.claude_code",
  },
  codex_cli: {
    mark: "openai",
    borderClass: "border-chatgpt",
    nameKey: "plans.console.providerBadge.codex_cli.name",
    accountKey: "plans.console.providerBadge.codex_cli.account",
  },
  antigravity: {
    mark: "antigravity",
    borderClass: "border-antigravity",
    nameKey: "plans.console.providerBadge.antigravity.name",
    accountKey: "plans.modelPicker.access.antigravity",
  },
  opencode: {
    mark: "opencode",
    borderClass: "border-opencode",
    nameKey: "plans.console.providerBadge.opencode.name",
    accountKey: "plans.modelPicker.access.opencode",
  },
  zai: {
    mark: "zai",
    borderClass: "border-zai",
    nameKey: "plans.console.providerBadge.zai.name",
    accountKey: "plans.modelPicker.access.zai",
  },
};

/**
 * Whether a runner has a provider badge of its own.
 * @param provider - The runner of the node, such as `claude_code` or `codex_cli`.
 * @returns `false` for a runner that keeps the plain label.
 */
export function hasProviderBadge(provider: string): boolean {
  return Object.hasOwn(PROVIDER_BADGES, provider);
}

/**
 * The provider of a node: the unchanged tile, the tool and the account, outlined in the provider's color.
 * @remarks
 * Claude Code reads „Claude Code │ Claude-Abo“ in `claude`, Codex reads
 * „Codex │ ChatGPT-Abo“ in `chatgpt` with the ChatGPT tile, Antigravity reads
 * „Antigravity CLI │ Google-Konto“ in `antigravity` with the white arch tile,
 * OpenCode and the direct Z.AI connection follow in their own tokens. When
 * the header is narrow, only the account is cut with "…"; tile and tool name
 * stay whole. The 18 px tile
 * with a 5 px radius sits 2 px from the top, bottom and left edge of the
 * 24 px badge, so the corners run parallel; a vertical rule separates the
 * tool from the account. A runner without a badge of its own draws nothing.
 */
export function ProviderBadge({
  provider,
}: {
  readonly provider: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const look: ProviderBadgeLook | undefined = PROVIDER_BADGES[provider];
  if (!look) return null;
  return (
    <span
      data-provider-badge={provider}
      className={cn(
        BADGE_CLASS,
        "bg-surface py-[2px] pr-2 pl-[2px]",
        look.borderClass,
      )}
    >
      <ToolMark mark={look.mark} className="size-[18px] rounded-[5px]" />
      <span className="shrink-0 text-foreground">{t(look.nameKey)}</span>
      <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
      <span className="min-w-0 truncate text-foreground">
        {t(look.accountKey)}
      </span>
    </span>
  );
}

/**
 * The state of the node as a badge with a 6 px dot, such as „Turn läuft“.
 * @remarks
 * Running work stands in the primary color. The badge shares the provider's
 * 24 px minimum height, 7 px radius and 1 px border, and grows when the label
 * needs more than one line.
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
      className={cn(BADGE_CLASS, "h-auto min-h-6 px-2 py-0.75", tone.badge)}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", tone.dot)}
      />
      <span className="min-w-0 wrap-anywhere">{state.label}</span>
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
