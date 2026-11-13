import { MessagesSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { ModelFieldRow } from "@/app/components/agents/model-picker/model-field";
import { DecisionRulesFields } from "@/app/components/common/decision-rules-fields";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  ChatDecisionAdministration,
  ChatDecisionStatus,
  ConversationDecisionRules,
} from "@/definition/ConversationDecision";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { FetcherWithComponents } from "react-router";

const STATUS_CLASSES: Readonly<Record<ChatDecisionStatus, string>> = {
  ready: "bg-success-subtle text-success",
  noModel: "bg-muted text-muted-foreground",
  modelUnavailable: "bg-warning-subtle text-warning",
};

interface ChatDecisionCardProps {
  readonly administration: ChatDecisionAdministration;
  /** Whether the last server refresh of a catalog failed; the model choice then warns. */
  readonly isCatalogFailed?: boolean;
}

/**
 * The decision model of the instance (PAGE-317, PAGE-379), next to speech
 * recognition and speech output and above Pica.
 *
 * @remarks
 * The card sets the decision model, chosen from the OpenRouter models that
 * state `decisions` as their output, and the default thresholds and the most
 * answering agents of the groups. The model only gives probabilities for
 * which agent a message of a group chat means; Pages decides with the
 * thresholds, and the model has no tools and runs no action. Saving is
 * allowed to administrators in the admin mode only, which the server checks
 * again.
 */
export function ChatDecisionCard({
  administration,
  isCatalogFailed,
}: ChatDecisionCardProps): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>({ key: "chat-decision" });
  return (
    <SettingsCard
      icon={<MessagesSquare className="size-4" />}
      title={t("chatDecision.title")}
      description={t("chatDecision.description")}
    >
      <ChatDecisionForm
        key={administration.settings.revision}
        administration={administration}
        isCatalogFailed={isCatalogFailed === true}
        fetcher={fetcher}
      />
    </SettingsCard>
  );
}

interface ChatDecisionDraft {
  readonly modelKey: string;
  readonly rules: ConversationDecisionRules;
  readonly selectModel: (key: string) => void;
  readonly setRules: (rules: ConversationDecisionRules) => void;
  readonly selection: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
}

function useChatDecisionDraft(
  administration: ChatDecisionAdministration,
  models: readonly PageAgentModel[],
): ChatDecisionDraft {
  const saved = administration.settings.selection;
  const savedKey = saved ? agentModelKey(saved.connectionId, saved.model) : "";
  const [modelKey, setModelKey] = useState(savedKey);
  const [rules, setRules] = useState(administration.settings.rules);
  const model = models.find((entry) => entry.id === modelKey);
  // A saved model the choice no longer lists keeps its value until another is chosen.
  const kept = modelKey === savedKey ? saved : null;
  return {
    modelKey,
    rules,
    selectModel: setModelKey,
    setRules,
    selection: model?.connectionId
      ? { connectionId: model.connectionId, model: model.model }
      : kept,
  };
}

function ChatDecisionForm({
  administration,
  isCatalogFailed,
  fetcher,
}: {
  readonly administration: ChatDecisionAdministration;
  readonly isCatalogFailed: boolean;
  readonly fetcher: FetcherWithComponents<AgentActionResult>;
}): React.ReactElement {
  const { t } = useTranslation();
  const { models } = administration;
  const draft = useChatDecisionDraft(administration, models);
  const isPending = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="save-chat-decision" />
      <input
        type="hidden"
        name="revision"
        value={administration.settings.revision}
      />
      <input
        type="hidden"
        name="modelConnectionId"
        value={draft.selection?.connectionId ?? ""}
      />
      <input type="hidden" name="model" value={draft.selection?.model ?? ""} />
      {Object.entries(draft.rules).map(([rule, value]) => (
        <input key={rule} type="hidden" name={rule} value={value} />
      ))}
      <ModelFieldRow>
        <ModelPicker
          value={draft.modelKey}
          models={models}
          savedModel={administration.settings.selection?.model ?? ""}
          disabled={isPending}
          label={t("chatDecision.model")}
          placeholder={t("chatDecision.chooseModel")}
          emptyLabel={t("chatDecision.noModels")}
          isCatalogFailed={isCatalogFailed}
          onChange={draft.selectModel}
        />
      </ModelFieldRow>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("chatDecision.defaults.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("chatDecision.defaults.description")}
        </p>
        <DecisionRulesFields
          rules={draft.rules}
          isDisabled={isPending}
          onChange={draft.setRules}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          role="status"
          className={cn(
            "rounded-md px-2 py-1 text-xs font-semibold",
            STATUS_CLASSES[administration.status],
          )}
        >
          {t(`chatDecision.status.${administration.status}`)}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-xs text-muted-foreground">
            {t("chatDecision.hint")}
          </p>
          <Button type="submit" size="sm" disabled={isPending}>
            {t("settings.agents.save")}
          </Button>
        </div>
      </div>
      <ChatDecisionFeedback result={isPending ? undefined : fetcher.data} />
    </fetcher.Form>
  );
}

function ChatDecisionFeedback({
  result,
}: {
  readonly result: AgentActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (result === undefined) return null;
  if (result.ok)
    return result.intent === "save-chat-decision" ? (
      <p role="status" className="text-sm text-success">
        {t("chatDecision.saved")}
      </p>
    ) : null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t([
        `chatDecision.error.${result.error}`,
        `settings.agents.error.${result.error}`,
        "chat.error.general",
      ])}
    </p>
  );
}
