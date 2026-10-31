import {
  Aperture,
  Asterisk,
  KeyRound,
  Route,
  Sparkles,
  SquareTerminal,
  Zap,
} from "lucide-react";

import { cn } from "@/app/lib/cn";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import type { ComponentType } from "react";
import type { AgentProviderId } from "@/definition/AgentConnection";

interface MarkProps {
  readonly className?: string;
  readonly strokeWidth?: number;
}

interface ProviderMark {
  readonly icon: ComponentType<MarkProps>;
  readonly className: string;
}

/*
 * The Google Antigravity mark exactly as Google LLC publishes it for ACP
 * clients in the Agent Client Protocol registry (antigravity-acp/icon.svg,
 * Apache-2.0 repository): a 16 × 16 monochrome path in `currentColor`, bundled
 * here so no page loads it from another host.
 */
function AntigravityMark({ className }: MarkProps): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M14.1452 14.6818C14.9937 15.3182 16.2664 14.894 15.0997 13.7273C11.5998 10.3333 12.3421 1 7.99366 1C3.64518 1 4.3876 10.3333 0.887603 13.7273C-0.385123 15 0.993664 15.3182 1.84215 14.6818C5.13002 12.4545 4.9179 8.5303 7.99366 8.5303C11.0694 8.5303 10.8573 12.4545 14.1452 14.6818Z"
        fill="currentColor"
      />
    </svg>
  );
}

/*
 * Branding note: the marks of Google, Z.AI, OpenRouter, OpenCode, OpenAI and
 * Anthropic are trademarks with their own brand rules, and this repository
 * bundles no licensed copies. As for the project interfaces, each provider
 * gets a neutral, unmodified Lucide icon on a tile in its brand color.
 * Google Antigravity is the exception: its vendor publishes the mark above for
 * exactly this use, so it is not mistaken for Google AI Studio.
 * The keys are the native OpenCode provider IDs, the Pages API providers and
 * `antigravity`.
 */
const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  zai: {
    icon: Zap,
    className: "bg-[#2d2d2d] text-white ring-1 ring-tile-edge",
  },
  google: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
  google_ai_studio: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
  antigravity: {
    icon: AntigravityMark,
    className: "bg-[#202124] text-white ring-1 ring-tile-edge",
  },
  openrouter: { icon: Route, className: "bg-[#6467f2] text-white" },
  opencode: {
    icon: SquareTerminal,
    className: "bg-[#211e1e] text-white ring-1 ring-tile-edge",
  },
  openai: {
    icon: Aperture,
    className: "bg-[#0d0d0d] text-white ring-1 ring-tile-edge",
  },
  anthropic: { icon: Asterisk, className: "bg-[#d97757] text-white" },
};

const FALLBACK_MARK: ProviderMark = {
  icon: KeyRound,
  className: "bg-muted text-muted-foreground",
};

/**
 * The mark key of a Pages connection provider.
 *
 * @param provider - The provider of a connection.
 * @returns `antigravity` for Google Antigravity, otherwise the provider's vendor.
 */
export function connectionMark(provider: AgentProviderId): string {
  return provider === "antigravity"
    ? "antigravity"
    : AGENT_PROVIDERS[provider].vendor;
}

interface ProviderIconProps {
  /** A Pages API provider such as `google_ai_studio` or a native OpenCode provider such as `google`. */
  readonly provider: string;
  readonly className?: string;
}

/**
 * The small, decorative tile that names a model provider in choices and lists.
 *
 * @remarks
 * The provider's name always stands beside the tile, so it is hidden from
 * assistive technology.
 */
export function ProviderIcon({
  provider,
  className,
}: ProviderIconProps): React.ReactElement {
  const mark = PROVIDER_MARKS[provider] ?? FALLBACK_MARK;
  const Icon = mark.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded",
        mark.className,
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.25} />
    </span>
  );
}
