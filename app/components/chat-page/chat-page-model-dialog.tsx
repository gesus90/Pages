import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { MODEL_FIELD_LABEL_CLASS } from "@/app/components/agents/model-picker/model-field";
import { PlanReasoningField } from "@/app/components/agents/plans/plan-node-card/plan-agent-fields";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { reasoningOptions } from "@/app/lib/reasoning-options";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { modelsOfSameTarget } from "@/definition/AgentReasoningChoice";

import { targetFields } from "./agent-control-api";
import { useAgentControl } from "./use-agent-control";
import { useModelChoice } from "./use-model-choice";

import type {
  AgentChatControlTarget,
  AgentChatModelChoice,
  AgentChatModelOverview,
} from "@/definition/AgentChatControl";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { ModelChoiceState } from "./use-model-choice";

/**
 * The translated name of a reasoning level, such as "hoch"; an unknown
 * level keeps its ID.
 * @param t - The translation function.
 * @param effort - The level.
 */
export function effortLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  effort: string,
): string {
  return t(`chatPage.modelChoice.effort.${effort}`, { defaultValue: effort });
}

/** One model of the chat's choice as an entry of the shared model choice. */
function chatPickerModel(choice: AgentChatModelChoice): PageAgentModel {
  return {
    id: agentModelKey(choice.connectionId, choice.model),
    connectionId: choice.connectionId,
    name: `${choice.name} · ${choice.connectionName}`,
    modelName: choice.name,
    connectionName: choice.connectionName,
    location: AGENT_PROVIDERS[choice.provider].location,
    model: choice.model,
    contextWindow: choice.contextWindow,
    provider: choice.provider,
    reasoning: choice.reasoningEfforts.length > 0 ? "levels" : "unknown",
    reasoningEfforts: choice.reasoningEfforts,
    catalogDefaultReasoningEffort: choice.defaultReasoningEffort,
    reasoningEffort: null,
    aliases: choice.aliases,
    ...(choice.isFree === undefined ? {} : { isFree: choice.isFree }),
  };
}

/**
 * Model and reasoning as two separate fields, like the footer of an agent
 * node: the shared model choice and the level choice of the chosen model.
 */
function ModelSearchBody({
  agentName,
  choice,
  overview,
  canControl,
}: {
  readonly agentName: string;
  readonly choice: ModelChoiceState;
  readonly overview: AgentChatModelOverview;
  readonly canControl: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { pick } = choice;
  const models = overview.choices.map(chatPickerModel);
  const key = pick ? agentModelKey(pick.connectionId, pick.model) : "";
  const model = models.find((entry) => entry.id === key);
  const effortOptions = reasoningOptions({
    model,
    modelName: model?.modelName ?? pick?.model ?? "",
    siblings: modelsOfSameTarget(models, model),
    current: pick?.reasoningEffort ?? null,
    defaultLabel: t("pageAgents.defaultReasoning"),
    translate: t,
  });

  function pickModel(id: string): void {
    const picked = overview.choices.find(
      (entry) => agentModelKey(entry.connectionId, entry.model) === id,
    );
    if (picked) choice.choose(picked);
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-2 items-start gap-2">
        <ModelPicker
          value={key}
          models={models}
          savedModel={pick?.model}
          savedProvider={model?.provider}
          disabled={!canControl}
          valueStyle="badge"
          hasCatalogStatus={false}
          onChange={pickModel}
        />
        <div className="min-w-0">
          <span className={MODEL_FIELD_LABEL_CLASS}>
            {t("pageAgents.reasoning")}
          </span>
          <PlanReasoningField
            value={pick?.reasoningEffort ?? ""}
            options={effortOptions}
            onChange={(effort) =>
              choice.chooseEffort(effort === "" ? null : effort)
            }
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("chatPage.modelChoice.onlyText", { agent: agentName })}
      </p>
    </>
  );
}

interface ModelDialogFooterProps {
  readonly canControl: boolean;
  readonly hasOverride: boolean;
  readonly canSwitch: boolean;
  readonly isPending: boolean;
  readonly onReset: () => void;
  readonly onClose: () => void;
  readonly onSwitch: () => void;
}

function ModelDialogFooter({
  canControl,
  hasOverride,
  canSwitch,
  isPending,
  onReset,
  onClose,
  onSwitch,
}: ModelDialogFooterProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <Button
        variant="outline"
        disabled={!canControl || !hasOverride}
        isPending={isPending}
        onClick={onReset}
      >
        {t("chatPage.modelChoice.reset")}
      </Button>
      <Button variant="outline" onClick={onClose}>
        {t("chatPage.modelChoice.cancel")}
      </Button>
      <Button
        disabled={!canControl || !canSwitch}
        isPending={isPending}
        onClick={onSwitch}
      >
        {t("chatPage.modelChoice.switch")}
      </Button>
    </div>
  );
}

interface ChatPageModelDialogProps {
  /** The chat and agent the dialog is open for; `null` while it is closed. */
  readonly target: AgentChatControlTarget | null;
  readonly agentName: string;
  readonly chatName: string;
  readonly onClose: () => void;
}

/**
 * The choice "Modell in diesem Chat …" of an agent: the shared model choice
 * with the text models of the connections the agent may use, the reasoning
 * field of the chosen model, "Auf Standard zurücksetzen" and "Wechseln".
 *
 * @remarks
 * Switching ends the session of the agent in this chat on purpose: the
 * running answer ends first, then the session starts anew with the new model
 * and its summary. A member without the right sees the choice disabled.
 */
export function ChatPageModelDialog({
  target,
  agentName,
  chatName,
  onClose,
}: ChatPageModelDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const choice = useModelChoice(target);
  const request = useAgentControl();
  const { overview, pick } = choice;
  const canControl = overview?.canControl === true;

  async function submit(fields: Record<string, string>): Promise<void> {
    if (target === null) return;
    const response = await request.send({ ...fields, ...targetFields(target) });
    if (response?.ok === true) onClose();
  }

  function handleSwitch(): void {
    if (pick === null) return;
    void submit({
      intent: "set-model",
      connectionId: pick.connectionId,
      model: pick.model,
      reasoningEffort: pick.reasoningEffort ?? "",
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.modelChoice.title", {
            agent: agentName,
            chat: chatName,
          })}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {overview
            ? t("chatPage.modelChoice.standardOf", {
                model: overview.standard.name,
              })
            : t("chatPage.modelChoice.loading")}
        </DialogDescription>
        {overview ? (
          <ModelSearchBody
            agentName={agentName}
            canControl={canControl}
            choice={choice}
            overview={overview}
          />
        ) : null}
        {overview && !canControl ? (
          <p className="mt-3 text-sm text-muted-foreground" role="note">
            {t("chatPage.agentMenu.noRight")}
          </p>
        ) : null}
        {request.failure === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t(`chatPage.control.failure.${request.failure}`)}
          </p>
        )}
        <ModelDialogFooter
          canControl={canControl}
          canSwitch={pick !== null}
          hasOverride={overview !== null && overview.override !== null}
          isPending={request.isPending}
          onClose={onClose}
          onReset={() => void submit({ intent: "reset-model" })}
          onSwitch={handleSwitch}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {t("chatPage.modelChoice.hint", {
            agent: agentName,
            model: choice.picked?.name ?? "",
          })}
        </p>
      </DialogContent>
    </Dialog>
  );
}
