import { CircleAlert, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

import type { ProjectGoal } from "@/definition/Project";

interface GoalRowProps {
  readonly goal: ProjectGoal;
  readonly canWrite: boolean;
}

/** Renders one goal with its done toggle and delete button for writers. */
function GoalRow({ goal, canWrite }: GoalRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <li className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm shadow-xs">
      {canWrite ? (
        <Form method="post" className="flex shrink-0 items-center">
          <input name="intent" type="hidden" value="toggle-goal" />
          <input name="goalId" type="hidden" value={goal.id} />
          <button
            type="submit"
            aria-label={goal.title}
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
              goal.isDone
                ? "border-primary bg-primary text-white"
                : "border-muted-foreground/40 text-transparent hover:border-primary",
            )}
          >
            <span aria-hidden="true" className="text-xs leading-none">
              ✓
            </span>
          </button>
        </Form>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
            goal.isDone
              ? "border-primary bg-primary text-white"
              : "border-muted-foreground/40",
          )}
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          goal.isDone
            ? "text-muted-foreground line-through"
            : "text-foreground",
        )}
      >
        {goal.title}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          goal.isDone ? "text-emerald-600" : "text-muted-foreground",
        )}
      >
        {goal.isDone
          ? t("projectDetail.general.goalDone")
          : t("projectDetail.general.goalOpen")}
      </span>
      {canWrite ? (
        <Form method="post" className="shrink-0">
          <input name="intent" type="hidden" value="delete-goal" />
          <input name="goalId" type="hidden" value={goal.id} />
          <button
            type="submit"
            aria-label={`${t("projects.actions.archive")}: ${goal.title}`}
            className="rounded-md px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            ×
          </button>
        </Form>
      ) : null}
    </li>
  );
}

interface GeneralGoalsSectionProps {
  readonly goals: readonly ProjectGoal[];
  readonly canWrite: boolean;
}

/** Renders the project goals with a form to add new ones for writers. */
export function GeneralGoalsSection({
  goals,
  canWrite,
}: GeneralGoalsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [isFormOpen, setIsFormOpen] = useState(false);

  function handleToggleForm(): void {
    setIsFormOpen((isOpen) => !isOpen);
  }

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
          <CircleAlert className="size-5 text-primary" aria-hidden="true" />
          {t("projectDetail.general.goals")}
        </h2>
        {canWrite ? (
          <Button
            variant="ghost"
            className="h-8 shrink-0 px-3 text-xs"
            onClick={handleToggleForm}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("projectDetail.general.addGoal")}
          </Button>
        ) : null}
      </div>
      {goals.length ? (
        <ul className="mt-4 flex flex-col gap-2.5">
          {goals.map((goal) => (
            <GoalRow key={goal.id} canWrite={canWrite} goal={goal} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("projectDetail.general.goalsEmpty")}
        </p>
      )}
      {canWrite && isFormOpen ? (
        <Form method="post" className="mt-4 flex gap-2">
          <input name="intent" type="hidden" value="create-goal" />
          <Input
            name="title"
            maxLength={200}
            placeholder={t("projectDetail.general.goals")}
            aria-label={t("projectDetail.general.goals")}
          />
          <Button type="submit" variant="ghost" className="shrink-0 border">
            {t("projectDetail.planning.create")}
          </Button>
        </Form>
      ) : null}
    </section>
  );
}
