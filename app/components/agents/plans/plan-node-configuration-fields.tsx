import { useTranslation } from "react-i18next";

import {
  PageAgentModelNotices,
  PageAgentReasoningField,
} from "@/app/components/agents/definitions/page-agent-model-fields";
import { ModelPicker } from "@/app/components/agents/model-picker";
import { ModelFieldRow } from "@/app/components/agents/model-picker/model-field";
import { OpenCodeRemoteFacts } from "@/app/components/settings/agents/opencode-remote-facts";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { consumerModels } from "@/definition/AgentModelConsumers";
import {
  planTargetModels,
  copyPlanConfiguration,
  planConfigurationModelKey,
  planSavedModel,
} from "@/definition/AgentPlanConfiguration";
import { effectivePlanTarget } from "@/definition/AgentPlanTarget";

import { PlanExecutionTargetSelect } from "./plan-execution-target-select";
import {
  PlanNodeContentFields,
  PlanNodeNameField,
} from "./plan-node-content-fields";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanCompletion } from "@/definition/AgentPlanSession";
import type { PageAgentInput, PageAgentModel } from "@/definition/PageAgent";

/**
 * The node with another released model and reasoning level.
 * @remarks
 * Only the node's own configuration copy changes, never its template. A
 * changed provider must support the node's retained run options.
 */
export function planStepWithModel(
  step: AgentPlanStep,
  configuration: AgentPlanConfiguration,
  model: PageAgentModel,
  reasoningEffort: string | null,
): AgentPlanStep {
  return {
    ...step,
    selectionRequired: undefined,
    configuration: {
      ...configuration,
      modelProfileId: model.id,
      connectionId: model.connectionId,
      runnerRoute: model.runnerRoute,
      model: model.model,
      provider: model.provider,
      reasoningEffort:
        model.reasoningEfforts.length > 0 ? reasoningEffort : null,
    },
  };
}

/** Chooses what decides that the node finished; it belongs to the node, not to its configuration copy. */
function PlanCompletionField(props: {
  readonly step: AgentPlanStep;
  readonly isGroupStep?: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  function change(completion: AgentPlanCompletion): void {
    const { completion: previous, ...rest } = step;
    if (completion === "todos") props.onChange({ ...rest, completion });
    else if (previous !== undefined) props.onChange(rest);
  }
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={`plan-completion-${step.id}`}>
        {t("plans.completion.label")}
      </label>
      <Select
        id={`plan-completion-${step.id}`}
        ariaLabel={t("plans.completion.label")}
        disabled={step.completionGate !== undefined}
        value={step.completion ?? "report"}
        options={[
          { value: "report", label: t("plans.completion.report") },
          { value: "todos", label: t("plans.completion.todos") },
        ]}
        onValueChange={change}
      />
      <p className="text-xs text-muted-foreground">
        {t(
          props.isGroupStep
            ? "plans.groups.acceptanceHint"
            : `plans.completion.${step.completion ?? "report"}Hint`,
        )}
      </p>
    </div>
  );
}

/**
 * Model and reasoning level of a node, chosen from the models of its effective execution target.
 *
 * @remarks
 * A model change stores the listed model's connection, route, model and
 * provider and keeps the saved reasoning level, which the level field then
 * offers or names as unsupported.
 */
function PlanNodeModelFields(props: {
  readonly step: AgentPlanStep;
  readonly configuration: AgentPlanConfiguration;
  readonly planTarget: AgentPlanExecutionTarget | undefined;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { configuration } = props;
  const models = planTargetModels(
    props.sources.models ?? [],
    effectivePlanTarget(props.step, { executionTarget: props.planTarget }),
  );
  const saved = planSavedModel(models, configuration);
  const modelKey = saved?.model.id ?? planConfigurationModelKey(configuration);
  const draft: PageAgentInput = {
    name: configuration.name,
    modelProfileId: modelKey,
    reasoningEffort: configuration.reasoningEffort,
    configuration: emptyAgentConfiguration(),
  };
  function changeModel(input: PageAgentInput): void {
    const model = models.find((entry) => entry.id === input.modelProfileId);
    if (!model) return;
    props.onChange(
      planStepWithModel(
        props.step,
        configuration,
        model,
        input.reasoningEffort,
      ),
    );
  }
  return (
    <div className="space-y-3">
      <ModelFieldRow>
        <ModelPicker
          value={modelKey}
          models={models}
          savedModel={configuration.model}
          disabled={props.disabled}
          onChange={(id) => changeModel({ ...draft, modelProfileId: id })}
        />
        <PageAgentReasoningField
          draft={draft}
          models={models}
          model={saved?.model}
          savedModel={configuration.model}
          disabled={props.disabled}
          onChange={changeModel}
        />
      </ModelFieldRow>
      <PageAgentModelNotices
        model={saved?.model}
        savedAlias={saved?.alias ?? null}
        isModelWithdrawn={
          !consumerModels("plan", models).some((model) => model.id === modelKey)
        }
      />
    </div>
  );
}

/** Edits the selected node's content and released model without writing to its template. */
export function PlanNodeConfigurationFields(props: {
  readonly step: AgentPlanStep;
  /** The plan's target, which the node runs on without one of its own. */
  readonly planTarget: AgentPlanExecutionTarget | undefined;
  readonly sources: AgentPlanSources;
  readonly workspaces?: readonly AgentWorkspaceChoice[];
  readonly disabled: boolean;
  readonly isGroupStep?: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const source = props.sources.agents.find(
    (entry) => entry.id === props.step.agentId,
  );
  const configuration =
    props.step.configuration ?? (source ? copyPlanConfiguration(source) : null);
  if (!configuration) return null;
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
      <PlanNodeNameField
        step={props.step}
        configuration={configuration}
        onChange={props.onChange}
      />
      <PlanExecutionTargetField
        configuration={configuration}
        step={props.step}
        planTarget={props.planTarget}
        sources={props.sources}
        onChange={props.onChange}
      />
      <PlanNodeModelFields
        step={props.step}
        configuration={configuration}
        planTarget={props.planTarget}
        sources={props.sources}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      <PlanRemoteStatus
        sources={props.sources}
        target={effectivePlanTarget(props.step, {
          executionTarget: props.planTarget,
        })}
      />
      <PlanNodeContentFields
        planTarget={props.planTarget}
        step={props.step}
        configuration={configuration}
        workspaces={props.workspaces}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {t("plans.completion.label")}
        </summary>
        <PlanCompletionField
          step={props.step}
          isGroupStep={props.isGroupStep}
          onChange={props.onChange}
        />
        {props.isGroupStep ? null : (
          <PlanCompletionGateField
            step={props.step}
            onChange={props.onChange}
          />
        )}
      </details>
    </fieldset>
  );
}

function PlanExecutionTargetField(props: {
  readonly step: AgentPlanStep;
  readonly planTarget: AgentPlanExecutionTarget | undefined;
  readonly sources: AgentPlanSources;
  readonly configuration: AgentPlanConfiguration;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function change(target: AgentPlanExecutionTarget | undefined): void {
    props.onChange({ ...props.step, executionTarget: target });
  }
  const model = props.sources.models?.find(
    (entry) =>
      entry.connectionId === props.configuration.connectionId &&
      entry.model === props.configuration.model,
  );
  return (
    <div className="space-y-4 text-sm">
      <PlanExecutionTargetSelect
        id={`plan-target-${props.step.id}`}
        target={props.step.executionTarget}
        planTarget={props.planTarget}
        choices={props.sources.remoteTargets ?? []}
        onChange={change}
      />
      <p className="space-y-1">
        <span className="block">{t("plans.execution.modelAccess")}</span>
        <span className="block rounded-xl border border-border px-3 py-2 text-xs">
          {model?.connectionName ??
            props.configuration.connectionId ??
            t("plans.execution.unavailable")}
        </span>
      </p>
    </div>
  );
}

function PlanCompletionGateField({
  step,
  onChange,
}: {
  readonly step: AgentPlanStep;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { completionGate: gate, ...withoutGate } = step;
  function toggle(): void {
    if (gate) {
      onChange(withoutGate);
      return;
    }
    onChange({
      ...step,
      completion: "todos",
      completionGate: {
        version: 1,
        requiredChecks: ["pnpm run check", "pnpm run lint"],
      },
    });
  }
  function changeChecks(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    const requiredChecks = [
      ...new Set(
        event.target.value
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
    onChange({
      ...step,
      completion: "todos",
      completionGate: { version: 1, requiredChecks },
    });
  }
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <Checkbox checked={gate !== undefined} onChange={toggle} />
        {t("plans.workGate.label")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t("plans.workGate.hint")}
      </p>
      {gate ? (
        <label className="block space-y-1">
          <span>{t("plans.workGate.checks")}</span>
          <Textarea
            key={step.id}
            defaultValue={gate.requiredChecks.join("\n")}
            onBlur={changeChecks}
            rows={4}
            required
          />
        </label>
      ) : null}
    </div>
  );
}

function PlanRemoteStatus({
  sources,
  target,
}: {
  readonly sources: AgentPlanSources;
  readonly target: AgentPlanExecutionTarget;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (target.kind !== "remote") return null;
  const status = sources.remoteStatus?.find(
    (entry) => entry.workspaceId === target.workspaceId,
  );
  if (!status) return null;
  return (
    <div
      role="status"
      className="space-y-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground"
    >
      {status.problem ? (
        <p>{t(`plans.panel.issueCause.${status.problem}`)}</p>
      ) : (
        <>
          {(["codex", "claude", "opencode", "antigravity"] as const).map(
            (tool) => {
              const entry = status.tools.find(
                (candidate) => candidate.tool === tool,
              );
              const reason = entry
                ? (entry.authentication ?? "unknown")
                : "missing";
              return (
                <p key={tool}>
                  {t(`settings.agents.runner.toolName.${tool}`)} ·{" "}
                  {t(`settings.agents.runner.auth.${reason}`)}
                  {entry?.authentication === "authenticated" &&
                  !entry.models?.length
                    ? ` · ${t("plans.panel.issueCause.remoteCatalog")}`
                    : ""}
                  {entry?.tool === "opencode" ? (
                    <OpenCodeRemoteFacts
                      entry={entry}
                      hasOpenCodeAccess={status.hasOpenCodeAccess === true}
                    />
                  ) : null}
                </p>
              );
            },
          )}
          {!status.hasModelCatalog ? (
            <p>{t("plans.execution.catalogMissing")}</p>
          ) : null}
        </>
      )}
      {status.catalogCheckedAt ? (
        <p>
          {t("plans.communication.catalogChecked", {
            at: status.catalogCheckedAt,
          })}
        </p>
      ) : null}
      <p>{t("plans.execution.remotePause")}</p>
      <a className="underline" href="/settings/agents">
        {t("plans.execution.runnerSettings")}
      </a>
    </div>
  );
}
