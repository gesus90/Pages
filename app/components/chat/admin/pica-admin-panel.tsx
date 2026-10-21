import { useTranslation } from "react-i18next";

import { PicaAdminBrowserSection } from "./pica-admin-browser";
import { PicaAdminFilesSection } from "./pica-admin-files";
import { AdminButton } from "./pica-admin-controls";
import { usePicaAdminTools } from "./use-pica-admin-tools";

/** Gives administrators visible browser/file results through the same native handlers Pica uses. */
export function PicaAdminPanel(): React.ReactElement {
  const { t } = useTranslation();
  const { isBusy, result, run } = usePicaAdminTools();
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">{t("picaAdmin.description")}</p>
      <PicaAdminBrowserSection isBusy={isBusy} run={run} />
      <PicaAdminFilesSection isBusy={isBusy} run={run} />
      <section
        aria-live="polite"
        className="space-y-2 rounded-xl border border-border bg-surface p-5"
      >
        <h2 className="font-semibold">{t("picaAdmin.result")}</h2>
        {result?.error ? (
          <p role="alert">
            {t(`picaAdmin.errors.${result.error}`, {
              defaultValue: t("picaAdmin.failed"),
            })}
          </p>
        ) : null}
        {result?.status ? (
          <p>
            {t(`picaAdmin.status.${result.status}`, {
              defaultValue: result.status,
            })}
          </p>
        ) : null}
        {result?.title ? <h3>{result.title}</h3> : null}
        {result?.target ? <p>{result.target}</p> : null}
        {result?.content ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">
            {result.content}
          </pre>
        ) : null}
      </section>
      <AdminButton
        disabled={isBusy}
        onClick={() => {
          void run("task_close", {});
        }}
      >
        {t("picaAdmin.finish")}
      </AdminButton>
    </div>
  );
}
