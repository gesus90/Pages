import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import type { ChangeEvent } from "react";
import type { Project } from "@/definition/Project";

interface GeneralIconSectionProps {
  readonly project: Project;
  readonly canWrite: boolean;
}

/** Renders the project icon with an upload button for writers. */
export function GeneralIconSection({
  project,
  canWrite,
}: GeneralIconSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const iconAddress = `/projekte/${project.id}/icon`;

  function handleIconChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    const formData = new FormData();

    formData.set("icon", file);
    void submit(formData, {
      action: iconAddress,
      encType: "multipart/form-data",
      method: "post",
    });
  }

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <h2 className="select-none font-semibold text-foreground">
        {t("projectDetail.general.icon")}
      </h2>
      <div className="mt-4 flex items-center gap-4">
        {project.hasIcon ? (
          <img
            className="size-16 shrink-0 rounded-xl object-cover"
            src={iconAddress}
            alt=""
          />
        ) : (
          <span
            className="inline-flex size-16 shrink-0 select-none items-center justify-center rounded-xl text-3xl font-semibold"
            style={{ backgroundColor: project.placeholderColor }}
            aria-hidden="true"
          >
            {project.name.trim().charAt(0).toLocaleUpperCase()}
          </span>
        )}
        {canWrite ? (
          <label className="inline-flex min-h-9 cursor-pointer select-none items-center rounded-xl bg-muted px-3 text-sm font-semibold text-foreground hover:bg-sidebar-hover">
            {t("projectDetail.general.changeIcon")}
            <input
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              name="icon"
              type="file"
              onChange={handleIconChange}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
