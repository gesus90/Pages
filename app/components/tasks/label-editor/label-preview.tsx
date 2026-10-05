import { useTranslation } from "react-i18next";

import { getLabelTextColor } from "@/app/components/tasks/label-color";

interface LabelPreviewProps {
  readonly name: string;
  readonly color: string;
}

/** Renders the label pill as it will look, with readable text on its color. */
export function LabelPreview({
  name,
  color,
}: LabelPreviewProps): React.ReactElement {
  const { t } = useTranslation();

  const previewName = name.trim() || t("tasks.labels.namePlaceholder");

  return (
    <div
      aria-label={t("tasks.labels.preview")}
      className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2"
      role="status"
    >
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
        {t("tasks.labels.preview")}
      </span>
      <span
        className="inline-flex max-w-full items-center gap-1 truncate rounded-md px-2 py-0.5 text-xs font-medium"
        style={{
          backgroundColor: `${color}26`,
          color: getLabelTextColor(color),
        }}
      >
        <span className="min-w-0 truncate">{previewName}</span>
      </span>
    </div>
  );
}
