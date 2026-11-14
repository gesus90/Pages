import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

import type { AgentDraft, AgentDraftChange } from "./agent-draft";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Optional Claude-plan budget; hidden for every other provider. */
export function ClaudeMonthlyBudgetField({
  draft,
  models,
  onChange,
  isDisabled,
}: {
  readonly draft: AgentDraft;
  readonly models: readonly PageAgentModel[];
  readonly onChange: AgentDraftChange;
  readonly isDisabled: boolean;
}): React.ReactElement | null {
  const id = useId();
  const { t } = useTranslation();
  if (
    models.find((model) => model.id === draft.modelKey)?.provider !==
    "claude_code"
  )
    return null;
  return (
    <label htmlFor={id} className="space-y-1 text-sm">
      <span>{t("agentEmployees.fields.claudeMonthlyLimit")}</span>
      <Input
        id={id}
        type="number"
        min="0"
        step="any"
        value={draft.claudeMonthlyCostLimitUsd ?? ""}
        disabled={isDisabled}
        onChange={(event) =>
          onChange("claudeMonthlyCostLimitUsd", event.target.value)
        }
      />
      <span className="block text-xs text-muted-foreground">
        {t("agentEmployees.fields.claudeMonthlyLimitHint")}
      </span>
    </label>
  );
}
