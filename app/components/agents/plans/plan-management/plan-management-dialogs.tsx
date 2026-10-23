import { PlanCloneDialog } from "./plan-clone-dialog";
import { PlanCreateDialog } from "./plan-create-dialog";
import { PlanDeleteDialog } from "./plan-delete-dialog";
import { PlanEditDialog } from "./plan-edit-dialog";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { usePlanEditor } from "../use-plan-editor";
import type { usePlanManagement } from "./use-plan-management";

/** The one dialog of the plan menu that is open, if any. */
export function PlanManagementDialogs({
  page,
  editor,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement | null {
  const plan = page.selected;
  if (management.dialog === "create")
    return <PlanCreateDialog page={page} management={management} />;
  if (!plan) return null;
  if (management.dialog === "edit")
    return (
      <PlanEditDialog
        page={page}
        plan={plan}
        editor={editor}
        management={management}
      />
    );
  if (management.dialog === "clone")
    return (
      <PlanCloneDialog
        page={page}
        source={plan}
        isDirty={editor.isDirty}
        management={management}
      />
    );
  if (management.dialog === "delete")
    return (
      <PlanDeleteDialog
        page={page}
        plan={plan}
        isDirty={editor.isDirty}
        management={management}
      />
    );
  return null;
}
