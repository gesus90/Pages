import { useTranslation } from "react-i18next";

import type { ProjectTemplate } from "@/definition/Project";

interface ProjectTemplateSummaryProps {
  readonly template: ProjectTemplate | null;
}

/** Previews only the reusable goals and tags; new departments remain an explicit selection. */
export function ProjectTemplateSummary({
  template,
}: ProjectTemplateSummaryProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (!template) return null;
  return (
    <section className="rounded-xl bg-muted/40 p-4 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("projects.templates.copyHint")}
      </p>
      <h3 className="mt-3 font-medium">{t("projectDetail.general.goals")}</h3>
      {template.goals.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {template.goals.map((goal, index) => (
            <li key={index}>{goal}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground">
          {t("projectDetail.general.goalsEmpty")}
        </p>
      )}
      <p className="mt-3 break-words text-muted-foreground">
        {t("projects.templates.tags", {
          tags: template.tags.join(", ") || t("projects.templates.noTags"),
        })}
      </p>
    </section>
  );
}
