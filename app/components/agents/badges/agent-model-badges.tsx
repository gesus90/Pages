import { useTranslation } from "react-i18next";

import { ClaudeModelBadge } from "./claude-model-badge";
import { ReasoningBadge } from "./reasoning-badge";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";

/**
 * The model and reasoning of an agent in a chat.
 * @remarks
 * Claude Code models get the shared Claude badge and the reasoning badge.
 * Every other provider keeps the grey pill of model and level until it is
 * moved to badges of its own; its text is joined from the structured values
 * here and never read back.
 */
export function AgentModelBadges({
  model,
}: {
  readonly model: AgentChatModelLabel;
}): React.ReactElement {
  const { t } = useTranslation();
  if (model.provider === "claude_code")
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <ClaudeModelBadge name={model.name} />
        {model.reasoningEffort ? (
          <ReasoningBadge level={model.reasoningEffort} />
        ) : null}
      </span>
    );
  const effort = model.reasoningEffort;
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      {effort
        ? `${model.name} · ${t(`chatPage.modelChoice.effort.${effort}`, { defaultValue: effort })}`
        : model.name}
    </span>
  );
}
