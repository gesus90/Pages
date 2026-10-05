import { useTranslation } from "react-i18next";

import { LabelEditor } from "@/app/components/tasks/label-editor";
import { LabelDeleteControl } from "@/app/components/tasks/label-picker/label-delete-control";

import type { LabelEditing } from "@/app/components/tasks/label-picker/use-label-editing";
import type { ProjectLabel } from "@/definition/Task";

interface LabelEditRowProps {
  readonly label: ProjectLabel;
  readonly usage: number;
  readonly isSubmitting: boolean;
  readonly editing: LabelEditing;
}

/** Renders the edit form of a label together with its delete control. */
export function LabelEditRow({
  label,
  usage,
  isSubmitting,
  editing,
}: LabelEditRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 p-1">
      <LabelEditor
        name={editing.editName}
        color={editing.editColor}
        isSaving={isSubmitting}
        canSave={editing.editName.trim().length > 0}
        saveLabel={t("tasks.labels.save")}
        onNameChange={editing.setEditName}
        onColorChange={editing.setEditColor}
        onSave={() => editing.saveEdit(label)}
        onCancel={editing.cancelEdit}
      />
      <LabelDeleteControl
        isConfirming={editing.confirmDeleteId === label.id}
        isSubmitting={isSubmitting}
        label={label}
        onCancel={editing.cancelDelete}
        onDelete={editing.deleteLabel}
        usage={usage}
      />
    </div>
  );
}
