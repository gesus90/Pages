import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { AGENT_RECIPE_LIMIT } from "@/definition/AgentDreaming";

import { DreamBadge, DreamCard } from "./agent-dreaming-widgets";
import { AgentRowActions } from "./agent-lessons-actions";
import {
  RECIPE_STATUS_TONES,
  describeRecipeUsage,
  lessonsPendingKey,
  readPendingRowAction,
  readRecipeStatus,
} from "./agent-lessons-display";
import { AgentRecipeDetails } from "./agent-recipe-details";
import { AgentRecipeEditor } from "./agent-recipe-editor";

import type { AgentRecipeInput } from "./agent-lessons-api";
import type { AgentLessonsState } from "./use-agent-lessons";
import type {
  AgentLessonsOverview,
  AgentRecipeView,
} from "@/definition/AgentDreaming";

/** Name, kind, status and strength of a recipe, and its short description. */
function RecipeHeader({
  recipe,
}: {
  readonly recipe: AgentRecipeView;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = readRecipeStatus(recipe);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-sm font-semibold break-all text-foreground">
          {recipe.name}
        </p>
        <DreamBadge tone="info">
          {t(`agentLessons.recipes.kind.${recipe.kind}`)}
        </DreamBadge>
        <DreamBadge tone={RECIPE_STATUS_TONES[status]}>
          {t(`agentLessons.recipes.status.${status}`, {
            failures: recipe.failureStreak,
          })}
        </DreamBadge>
        <DreamBadge>
          {t("agentLessons.strength", { strength: recipe.strength })}
        </DreamBadge>
      </div>
      <p className="text-sm break-words text-foreground">{recipe.summary}</p>
    </div>
  );
}

/** How often the recipe was used, what it rests on, when it was confirmed and who made it. */
function RecipeMeta({
  recipe,
}: {
  readonly recipe: AgentRecipeView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = useRegionFormatter();
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <p>{describeRecipeUsage(recipe, formatDateTime, t)}</p>
      <p className="break-words">
        {recipe.evidence === ""
          ? null
          : `${t("agentLessons.evidence", { evidence: recipe.evidence })} · `}
        {t("agentLessons.date", { date: formatDate(recipe.date) })}
        {" · "}
        {t(`agentLessons.recipes.origin.${recipe.origin}`)}
      </p>
      {recipe.lastError === null ? null : (
        <p className="break-words text-destructive/80">
          {t("agentLessons.recipes.lastError", { error: recipe.lastError })}
        </p>
      )}
    </div>
  );
}

interface RecipeRowProps {
  readonly recipe: AgentRecipeView;
  readonly lessons: AgentLessonsState;
}

/** One recipe with its details to open, and the buttons to change it. */
function RecipeRow({ recipe, lessons }: RecipeRowProps): React.ReactElement {
  const { t } = useTranslation();
  const detailsId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { pendingKey } = lessons;
  const isBusy = pendingKey !== null;

  async function handleSave(input: AgentRecipeInput): Promise<void> {
    if (await lessons.saveRecipe(input)) setIsEditing(false);
  }

  if (isEditing)
    return (
      <li className="rounded-lg border border-border/60 p-3">
        <AgentRecipeEditor
          recipe={recipe}
          isBusy={isBusy}
          isSaving={
            pendingKey === lessonsPendingKey("save-recipe", recipe.id)
          }
          onSave={(input) => void handleSave(input)}
          onCancel={() => setIsEditing(false)}
        />
      </li>
    );
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <RecipeHeader recipe={recipe} />
      <RecipeMeta recipe={recipe} />
      <Button
        aria-controls={detailsId}
        aria-expanded={isOpen}
        aria-label={t(
          isOpen
            ? "agentLessons.recipes.hideDetailsFor"
            : "agentLessons.recipes.showDetailsFor",
          { name: recipe.name },
        )}
        className="self-start"
        onClick={() => setIsOpen(!isOpen)}
        size="sm"
        variant="link"
      >
        {t(
          isOpen
            ? "agentLessons.recipes.hideDetails"
            : "agentLessons.recipes.showDetails",
        )}
      </Button>
      <div id={detailsId}>
        {isOpen ? <AgentRecipeDetails recipe={recipe} /> : null}
      </div>
      <AgentRowActions
        kind="recipe"
        subject={recipe.name}
        isActive={recipe.isActive}
        isBusy={isBusy}
        pendingAction={readPendingRowAction(pendingKey, "recipe", recipe.id)}
        onEdit={() => setIsEditing(true)}
        onToggle={() =>
          void lessons.setRecipeActive(recipe.id, !recipe.isActive)
        }
        onRemove={() => void lessons.removeRecipe(recipe.id)}
      />
    </li>
  );
}

/**
 * The card "Rezepte": every recipe with its name, kind, status, usage and
 * details, and the buttons to edit, switch off and delete it.
 */
export function AgentRecipesList({
  overview,
  lessons,
}: {
  readonly overview: AgentLessonsOverview;
  readonly lessons: AgentLessonsState;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DreamCard
      title={t("agentLessons.recipes.title")}
      action={
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("agentLessons.recipes.count", {
            count: overview.recipes.length,
            limit: AGENT_RECIPE_LIMIT,
          })}
        </span>
      }
    >
      <p className="text-xs text-muted-foreground">
        {t("agentLessons.recipes.hint")}
      </p>
      {overview.recipes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("agentLessons.recipes.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.recipes.map((recipe) => (
            <RecipeRow key={recipe.id} recipe={recipe} lessons={lessons} />
          ))}
        </ul>
      )}
    </DreamCard>
  );
}
