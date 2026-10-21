import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminButton, AdminField } from "./pica-admin-controls";

import type { AdminSectionProps } from "./pica-admin-controls";

/** Presents read-before-edit controls for one unique passage in the explicit handover folder. */
export function PicaAdminFilesSection({
  isBusy,
  run,
}: AdminSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [filePath, setFilePath] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  return (
    <fieldset
      disabled={isBusy}
      className="space-y-3 rounded-xl border border-border bg-surface p-5"
    >
      <legend className="px-2 font-semibold">{t("picaAdmin.files")}</legend>
      <p className="text-sm text-muted-foreground">{t("picaAdmin.paths")}</p>
      <AdminField
        label={t("picaAdmin.path")}
        value={filePath}
        onChange={setFilePath}
      />
      <div className="flex gap-2">
        <AdminButton
          onClick={() => {
            void run("admin_files_find", { directory: filePath });
          }}
        >
          {t("picaAdmin.find")}
        </AdminButton>
        <AdminButton
          onClick={() => {
            void run("admin_files_read", { path: filePath });
          }}
        >
          {t("picaAdmin.read")}
        </AdminButton>
      </div>
      <AdminField
        label={t("picaAdmin.before")}
        value={before}
        onChange={setBefore}
        multiline
      />
      <AdminField
        label={t("picaAdmin.after")}
        value={after}
        onChange={setAfter}
        multiline
      />
      <AdminButton
        onClick={() => {
          void run("admin_files_edit", { path: filePath, before, after });
        }}
      >
        {t("picaAdmin.edit")}
      </AdminButton>
    </fieldset>
  );
}
