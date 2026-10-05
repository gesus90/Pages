import { useTranslation } from "react-i18next";

import { LabelColorPresets } from "@/app/components/tasks/label-editor/label-color-presets";
import { LabelCustomColor } from "@/app/components/tasks/label-editor/label-custom-color";
import { LabelEditorActions } from "@/app/components/tasks/label-editor/label-editor-actions";
import { LabelPreview } from "@/app/components/tasks/label-editor/label-preview";
import { Input } from "@/app/components/ui/input";
import { focusOnMount } from "@/app/lib/focus-on-mount";
import { DEFAULT_LABEL_COLOR, normalizeHexColorCode } from "@/definition/Task";

interface LabelEditorProps {
  readonly name: string;
  readonly color: string;
  readonly isSaving?: boolean;
  readonly canSave: boolean;
  readonly saveLabel: string;
  readonly onNameChange: (name: string) => void;
  readonly onColorChange: (color: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/**
 * Renders the shared name-and-color form for creating and editing labels.
 *
 * @remarks
 * Create and edit flows share this surface so presets, the free picker, and
 * the live preview never drift apart: quick preset swatches with a clear
 * current-color mark, an expandable hexagon picker for arbitrary hex colors,
 * and a preview pill using the Pages label geometry with readable text.
 */
export function LabelEditor({
  name,
  color,
  isSaving = false,
  canSave,
  saveLabel,
  onNameChange,
  onColorChange,
  onSave,
  onCancel,
}: LabelEditorProps): React.ReactElement {
  const { t } = useTranslation();

  const normalizedColor = normalizeHexColorCode(color) ?? DEFAULT_LABEL_COLOR;

  function handleNameKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Enter" && canSave && !isSaving) {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Input
          aria-label={t("tasks.labels.name")}
          ref={focusOnMount}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={handleNameKeyDown}
          placeholder={t("tasks.labels.namePlaceholder")}
          value={name}
        />
        <LabelPreview color={normalizedColor} name={name} />
      </div>

      <LabelColorPresets
        activeColor={normalizedColor}
        onSelect={onColorChange}
      />

      <LabelCustomColor color={normalizedColor} onChange={onColorChange} />

      <LabelEditorActions
        isSaveDisabled={isSaving || !canSave}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={saveLabel}
      />
    </div>
  );
}
