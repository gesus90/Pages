import { useTranslation } from "react-i18next";

import { modelBadgeVendor } from "@/definition/AgentModelIdentity";

import { modelBadgeDisplay } from "../model-picker/model-catalog";
import { FreeBadge } from "./free-badge";
import { ModelBadge } from "./model-badge";
import { ReasoningBadge } from "./reasoning-badge";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { AgentValueStatus } from "@/definition/AgentModelIdentity";

/** What the badges read of a model: the live label of a chat or the model kept with a stored answer. */
export type AgentModelBadgeValues = Pick<
  AgentChatModelLabel,
  "name" | "provider" | "modelId" | "reasoningEffort" | "isFree"
> & {
  readonly modelStatus?: AgentValueStatus;
  readonly reasoningStatus?: AgentValueStatus;
  readonly isReasoningOffered?: boolean | null;
};

/**
 * The model and reasoning of an agent in a chat.
 * @remarks
 * The order is model, "Free", reasoning, 6 px apart. Claude Code, Codex,
 * Antigravity, OpenCode, OpenRouter and direct Z.AI models get the shared
 * model and reasoning badges. A known model source appears in the tooltip.
 * Every other provider
 * keeps the grey pill of model and level until it is moved to badges of its own; its text is joined from the
 * structured values here and never read back. "Free" stands as a badge of its
 * own beside either, only where the catalog of the used connection states it
 * (`isFree`), never because of the name; a trailing "Free" of the catalog
 * name then stands in the badge alone. Only the model name is cut with an
 * ellipsis, the full name stands in its tooltip; "Free" and the reasoning
 * never shrink. `isCompactWhenNarrow` drops the vendor word of the model
 * badge in a container narrower than 520 px; the caller provides it.
 */
export function AgentModelBadges({
  model,
  isCompactWhenNarrow = false,
}: {
  readonly model: AgentModelBadgeValues;
  readonly isCompactWhenNarrow?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const vendor = modelBadgeVendor(model.provider);
  const isFree = model.isFree === true;
  const { name, source } = modelBadgeDisplay(model, t);
  const free = isFree ? <FreeBadge size="badge" /> : null;
  if (vendor)
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <ModelBadge
          vendor={vendor}
          name={name}
          source={source}
          status={model.modelStatus}
          isVendorHiddenWhenNarrow={isCompactWhenNarrow}
        />
        {free}
        {model.reasoningEffort ? (
          <ReasoningBadge
            level={model.reasoningEffort}
            status={model.reasoningStatus}
            isOffered={model.isReasoningOffered}
          />
        ) : null}
      </span>
    );
  const effort = model.reasoningEffort;
  const text = effort
    ? `${name} · ${t(`chatPage.modelChoice.effort.${effort}`, { defaultValue: effort })}`
    : name;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <span
        title={text}
        className="min-w-0 truncate rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
      >
        {text}
      </span>
      {free}
    </span>
  );
}
