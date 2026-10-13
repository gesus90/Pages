import { Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";

/** Keeps the page chrome when the list cannot be loaded and offers a retry unless access was refused. */
export function WorkspaceLoadError(): React.ReactElement {
  const { t } = useTranslation();
  const error = useRouteError();
  const revalidator = useRevalidator();
  const isForbidden = isRouteErrorResponse(error) && error.status === 403;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-2 pt-3 pb-10">
      <h1 className="text-2xl font-bold">{t("workspaces.title")}</h1>
      <SettingsCard
        icon={<Folder className="size-5" />}
        title={t("workspaces.listTitle")}
        description={t("workspaces.description")}
      >
        <p role="alert" className="pages-selectable text-sm text-destructive">
          {t(
            isForbidden
              ? "errorPage.forbidden.message"
              : "workspaces.loadError",
          )}
        </p>
        {isForbidden ? null : (
          <Button
            className="mt-4"
            variant="outline"
            disabled={revalidator.state !== "idle"}
            onClick={() => {
              void revalidator.revalidate();
            }}
          >
            {t("workspaces.retry")}
          </Button>
        )}
      </SettingsCard>
    </div>
  );
}
