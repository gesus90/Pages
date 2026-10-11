import { Play, Plus, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

/** Saved plan navigation uses the existing route so back/forward and dirty-draft protection work together. */
export function PlanHeader({
  page,
}: {
  readonly page: AgentPlanPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  function selectPlan(id: string): void {
    void navigate(
      id ? `/agents/plans?planId=${encodeURIComponent(id)}` : "/agents/plans",
    );
  }
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{t("plans.title")}</h1>
      <div className="flex items-center gap-2">
        <Select
          ariaLabel={t("plans.choosePlan")}
          value={page.selected?.id ?? ""}
          onValueChange={selectPlan}
          options={[
            { value: "", label: t("plans.newPlan") },
            ...page.plans.map((plan) => ({ value: plan.id, label: plan.name })),
          ]}
        />
        <Button size="sm" variant="outline" onClick={() => selectPlan("")}>
          <Plus className="size-4" aria-hidden="true" />
          {t("plans.newPlan")}
        </Button>
      </div>
    </header>
  );
}

/** Play operates on a saved revision, while saving remains an explicit graph edit action. */
export function PlanActions(props: {
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly hasSelection: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { editor } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={
          !editor.canEdit ||
          editor.isPending ||
          !editor.draft.name.trim() ||
          !editor.draft.workspaceId
        }
        onClick={editor.save}
      >
        <Save className="size-4" aria-hidden="true" />
        {t("plans.save")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={
          editor.isPending ||
          !props.hasSelection ||
          editor.isDirty ||
          !editor.draft.nodes.some((node) => node.type === "agent")
        }
        onClick={editor.play}
      >
        <Play className="size-4" aria-hidden="true" />
        {t("plans.play")}
      </Button>
      {editor.isDirty ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.saveBeforePlay")}
        </p>
      ) : null}
    </div>
  );
}
