import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import {
  AGENT_RECIPE_BODY_CHARACTERS,
  AGENT_RECIPE_NAME_CHARACTERS,
  AGENT_RECIPE_SUMMARY_CHARACTERS,
} from "@/definition/AgentDreaming";

import {
  RecipeParameterFields,
  RecipeStepFields,
} from "./agent-recipe-flow-fields";
import { useRecipeDraft } from "./use-recipe-draft";

import type { AgentRecipeInput } from "./agent-lessons-api";
import type { RecipeDraft } from "./use-recipe-draft";
import type { AgentRecipeView } from "@/definition/AgentDreaming";

interface TextFieldsProps {
  readonly draft: RecipeDraft;
  readonly baseId: string;
}

/** Name, short description and keywords of a recipe. */
function RecipeTextFields({
  draft,
  baseId,
}: TextFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const { form, problems } = draft;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`${baseId}-name`}
        >
          {t("agentLessons.editor.name")}
        </label>
        <Input
          aria-invalid={problems.hasNameProblem}
          className="font-mono"
          id={`${baseId}-name`}
          maxLength={AGENT_RECIPE_NAME_CHARACTERS}
          onChange={(event) => draft.setText("name", event.currentTarget.value)}
          value={form.name}
        />
        <p
          className={
            problems.hasNameProblem
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
          role={problems.hasNameProblem ? "alert" : undefined}
        >
          {problems.hasNameProblem
            ? t("agentLessons.editor.nameInvalid", {
                limit: AGENT_RECIPE_NAME_CHARACTERS,
              })
            : t("agentLessons.editor.nameHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`${baseId}-keywords`}
        >
          {t("agentLessons.editor.keywords")}
        </label>
        <Input
          id={`${baseId}-keywords`}
          onChange={(event) =>
            draft.setText("keywordsText", event.currentTarget.value)
          }
          value={form.keywordsText}
        />
        <p className="text-xs text-muted-foreground">
          {t("agentLessons.editor.keywordsHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`${baseId}-summary`}
        >
          {t("agentLessons.editor.summary")}
        </label>
        <Input
          aria-invalid={problems.hasSummaryProblem}
          id={`${baseId}-summary`}
          maxLength={AGENT_RECIPE_SUMMARY_CHARACTERS}
          onChange={(event) =>
            draft.setText("summary", event.currentTarget.value)
          }
          value={form.summary}
        />
        {problems.hasSummaryProblem ? (
          <p className="text-xs text-destructive" role="alert">
            {t("agentLessons.editor.summaryInvalid", {
              limit: AGENT_RECIPE_SUMMARY_CHARACTERS,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The guide of a knowledge recipe. */
function RecipeBodyField({
  draft,
  baseId,
}: TextFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs text-muted-foreground"
        htmlFor={`${baseId}-body`}
      >
        {t("agentLessons.editor.body")}
      </label>
      <Textarea
        aria-invalid={draft.problems.hasBodyProblem}
        className="min-h-32"
        id={`${baseId}-body`}
        maxLength={AGENT_RECIPE_BODY_CHARACTERS}
        onChange={(event) => draft.setText("body", event.currentTarget.value)}
        value={draft.form.body}
      />
      <p
        className={
          draft.problems.hasBodyProblem
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
        role={draft.problems.hasBodyProblem ? "alert" : undefined}
      >
        {draft.problems.hasBodyProblem
          ? t("agentLessons.editor.bodyInvalid", {
              limit: AGENT_RECIPE_BODY_CHARACTERS,
            })
          : t("agentLessons.editor.bodyCount", {
              count: draft.form.body.length,
              limit: AGENT_RECIPE_BODY_CHARACTERS,
            })}
      </p>
    </div>
  );
}

interface AgentRecipeEditorProps {
  readonly recipe: AgentRecipeView;
  /** Whether a change runs now; the buttons wait for it. */
  readonly isBusy: boolean;
  /** Whether this recipe is the one being saved. */
  readonly isSaving: boolean;
  readonly onSave: (recipe: AgentRecipeInput) => void;
  readonly onCancel: () => void;
}

/**
 * The editor of one recipe: name, description and keywords for both kinds, the
 * parameters and steps of a flow recipe, the guide of a knowledge recipe.
 *
 * @remarks
 * What is entered is checked before anything is sent: a step's input must be a
 * JSON object, and a flow recipe needs a step with a tool.
 */
export function AgentRecipeEditor({
  recipe,
  isBusy,
  isSaving,
  onSave,
  onCancel,
}: AgentRecipeEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const baseId = useId();
  const draft = useRecipeDraft(recipe);

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft.input !== null && !isBusy) onSave(draft.input);
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <RecipeTextFields draft={draft} baseId={baseId} />
      {recipe.kind === "flow" ? (
        <>
          <RecipeParameterFields draft={draft} baseId={baseId} />
          <RecipeStepFields draft={draft} baseId={baseId} />
        </>
      ) : (
        <RecipeBodyField draft={draft} baseId={baseId} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={draft.input === null || isBusy}
          isPending={isSaving}
          size="sm"
          type="submit"
        >
          {t("agentLessons.editor.save")}
        </Button>
        <Button
          disabled={isSaving}
          onClick={onCancel}
          size="sm"
          variant="outline"
        >
          {t("agentLessons.editor.cancel")}
        </Button>
      </div>
    </form>
  );
}
