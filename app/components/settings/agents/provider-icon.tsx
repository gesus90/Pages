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

import type { LucideIcon } from "lucide-react";

interface ProviderMark {
  readonly icon: LucideIcon;
  readonly className: string;
}

/*
 * Branding note: the marks of Google, Z.AI, OpenRouter, OpenCode, OpenAI and
 * Anthropic are trademarks with their own brand rules, and this repository
 * bundles no licensed copies. As for the project interfaces, each provider
 * gets a neutral, unmodified Lucide icon on a tile in its brand color.
 * The keys are the native OpenCode provider IDs and the Pages API providers.
 */
const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  zai: {
    icon: Zap,
    className: "bg-[#2d2d2d] text-white ring-1 ring-tile-edge",
  },
  google: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
  google_ai_studio: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
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
