import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import {
  AGENT_RECIPE_PARAMETER_LIMIT,
  AGENT_RECIPE_STEP_LIMIT,
} from "@/definition/AgentDreaming";

import type { StepRow } from "./agent-recipe-draft";
import type { RecipeDraft } from "./use-recipe-draft";

interface FlowFieldsProps {
  readonly draft: RecipeDraft;
  /** Prefix of the IDs of the fields, unique per editor. */
  readonly baseId: string;
}

/** The parameters of a flow recipe: a name and a description each, added and removed freely. */
export function RecipeParameterFields({
  draft,
  baseId,
}: FlowFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const { parameters } = draft.form;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-muted-foreground">
        {t("agentLessons.editor.parameters")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("agentLessons.editor.parametersHint", { example: "{{name}}" })}
      </p>
      {parameters.map((row, index) => (
        <div
          key={row.key}
          className="grid items-center gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
        >
          <Input
            aria-label={t("agentLessons.editor.parameterName", {
              number: index + 1,
            })}
            className="font-mono"
            id={`${baseId}-parameter-${String(row.key)}`}
            onChange={(event) =>
              draft.updateParameter(row.key, {
                name: event.currentTarget.value,
              })
            }
            placeholder={t("agentLessons.editor.parameterNamePlaceholder")}
            value={row.name}
          />
          <Input
            aria-label={t("agentLessons.editor.parameterDescription", {
              number: index + 1,
            })}
            onChange={(event) =>
              draft.updateParameter(row.key, {
                description: event.currentTarget.value,
              })
            }
            placeholder={t(
              "agentLessons.editor.parameterDescriptionPlaceholder",
            )}
            value={row.description}
          />
          <Button
            aria-label={t("agentLessons.editor.removeParameter", {
              number: index + 1,
            })}
            onClick={() => draft.removeParameter(row.key)}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
      {draft.problems.hasParameterProblem ? (
        <p className="text-xs text-destructive" role="alert">
          {t("agentLessons.editor.parameterInvalid")}
        </p>
      ) : null}
      <Button
        className="self-start"
        disabled={parameters.length >= AGENT_RECIPE_PARAMETER_LIMIT}
        onClick={draft.addParameter}
        size="xs"
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {t("agentLessons.editor.addParameter")}
      </Button>
    </fieldset>
  );
}

interface StepFieldsProps extends FlowFieldsProps {
  readonly row: StepRow;
  readonly index: number;
}

/** One step: the tool, a note and the input as the text of a JSON object. */
function StepFields({
  draft,
  baseId,
  row,
  index,
}: StepFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const id = `${baseId}-step-${String(row.key)}`;
  const hasToolProblem = draft.problems.stepToolProblems[index] === true;
  const hasInputProblem = draft.problems.stepInputProblems[index] === true;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          {t("agentLessons.editor.stepNumber", { number: index + 1 })}
        </span>
        <Button
          aria-label={t("agentLessons.editor.removeStep", {
            number: index + 1,
          })}
          onClick={() => draft.removeStep(row.key)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`${id}-tool`}
          >
            {t("agentLessons.editor.stepTool")}
          </label>
          <Input
            aria-invalid={hasToolProblem}
            className="font-mono"
            id={`${id}-tool`}
            onChange={(event) =>
              draft.updateStep(row.key, { tool: event.currentTarget.value })
            }
            value={row.tool}
          />
          {hasToolProblem ? (
            <p className="text-xs text-destructive" role="alert">
              {t("agentLessons.editor.stepToolInvalid")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`${id}-note`}
          >
            {t("agentLessons.editor.stepNote")}
          </label>
          <Input
            id={`${id}-note`}
            onChange={(event) =>
              draft.updateStep(row.key, { note: event.currentTarget.value })
            }
            value={row.note}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`${id}-input`}
        >
          {t("agentLessons.editor.stepInput")}
        </label>
        <Textarea
          aria-invalid={hasInputProblem}
          className="min-h-20 font-mono text-xs"
          id={`${id}-input`}
          onChange={(event) =>
            draft.updateStep(row.key, { inputText: event.currentTarget.value })
          }
          rows={3}
          spellCheck={false}
          value={row.inputText}
        />
        {hasInputProblem ? (
          <p className="text-xs text-destructive" role="alert">
            {t("agentLessons.editor.stepInputInvalid", {
              example: '{"ticket": "{{ticket}}"}',
            })}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The steps of a flow recipe, in order, added and removed freely. */
export function RecipeStepFields({
  draft,
  baseId,
}: FlowFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const { steps } = draft.form;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-muted-foreground">
        {t("agentLessons.editor.steps")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("agentLessons.editor.stepsHint", {
          parameter: "{{name}}",
          result: "{{2.ticket.id}}",
        })}
      </p>
      <ol className="flex flex-col gap-3">
        {steps.map((row, index) => (
          <StepFields
            key={row.key}
            draft={draft}
            baseId={baseId}
            row={row}
            index={index}
          />
        ))}
      </ol>
      {draft.problems.hasNoSteps ? (
        <p className="text-xs text-destructive" role="alert">
          {t("agentLessons.editor.noSteps")}
        </p>
      ) : null}
      <Button
        className="self-start"
        disabled={steps.length >= AGENT_RECIPE_STEP_LIMIT}
        onClick={draft.addStep}
        size="xs"
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {t("agentLessons.editor.addStep")}
      </Button>
    </fieldset>
  );
}
