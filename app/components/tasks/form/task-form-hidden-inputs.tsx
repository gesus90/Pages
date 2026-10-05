import type { TaskFormSelections } from "./task-form-selections";

interface TaskFormHiddenInputsProps {
  readonly mode: "create" | "edit";
  readonly editedItemId: string | undefined;
  readonly selections: TaskFormSelections;
}

/** Posts the intent, the edited item and the selected values with the form. */
export function TaskFormHiddenInputs({
  mode,
  editedItemId,
  selections,
}: TaskFormHiddenInputsProps): React.ReactElement {
  return (
    <>
      <input
        name="intent"
        type="hidden"
        value={mode === "create" ? "create-task" : "update-task"}
      />
      {editedItemId ? (
        <input name="id" type="hidden" value={editedItemId} />
      ) : null}
      <input name="type" type="hidden" value={selections.type} />
      <input name="projectId" type="hidden" value={selections.projectId} />
      <input name="statusId" type="hidden" value={selections.statusId} />
      <input name="priority" type="hidden" value={selections.priority} />
      <input name="assigneeId" type="hidden" value={selections.assigneeId} />
      <input name="milestoneId" type="hidden" value={selections.milestoneId} />
      <input name="parentId" type="hidden" value={selections.parentId} />
      {mode === "edit" ? (
        <input name="reporterId" type="hidden" value={selections.reporterId} />
      ) : null}
    </>
  );
}
