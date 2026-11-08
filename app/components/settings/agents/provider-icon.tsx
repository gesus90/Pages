import { Asterisk, KeyRound, Sparkles } from "lucide-react";

import {
  ToolMark,
  hasToolMark,
} from "@/app/components/agents/model-picker/tool-mark";
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
 * The tools of the model choice (Claude Code, Codex, Antigravity, OpenCode,
 * OpenRouter and Z.AI) show their own app icons, the same tiles as in the
 * model choice. The other providers have no icon of their own in this
 * repository and keep a neutral Lucide icon on a tile in their brand color.
 * The keys are the native OpenCode provider IDs, the mark keys of the
 * provider registry and the Pages API providers.
 */
const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  google: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
  google_ai_studio: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
  gemini: { icon: Sparkles, className: "bg-[#1a73e8] text-white" },
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
 * @returns The mark the provider registry names, the same as in the model choice.
 */
export function connectionMark(provider: AgentProviderId): string {
  return AGENT_PROVIDERS[provider].mark;
}

interface ProviderIconProps {
  /** A Pages API provider such as `google_ai_studio` or a native OpenCode provider such as `google`. */
  readonly provider: string;
  readonly className?: string;
}

/**
 * The small, decorative 20 × 20 tile that names a model provider in choices and lists.
 *
 * @remarks
 * The provider's name always stands beside the tile, so it is hidden from
 * assistive technology.
 */
export function ProviderIcon({
  provider,
  className,
}: ProviderIconProps): React.ReactElement {
  if (hasToolMark(provider))
    return <ToolMark mark={provider} className={className} />;
  const mark = PROVIDER_MARKS[provider] ?? FALLBACK_MARK;
  const Icon = mark.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[5px]",
        mark.className,
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.25} />
    </span>
  );
}
