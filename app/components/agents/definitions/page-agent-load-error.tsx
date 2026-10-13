import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from "react-router";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";

/** Keeps the page chrome when the agents cannot be loaded and offers a retry unless access was refused. */
export function PageAgentLoadError(): React.ReactElement {
  const { t } = useTranslation();
  const error = useRouteError();
  const revalidator = useRevalidator();
  const isForbidden = isRouteErrorResponse(error) && error.status === 403;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-2 pt-3 pb-10">
      <h1 className="text-2xl font-bold">{t("navigation.agentList")}</h1>
      <SettingsCard
        icon={<Bot className="size-5" />}
        title={t("pageAgents.listTitle")}
        description={t("pageAgents.description")}
      >
        <p role="alert" className="pages-selectable text-sm text-destructive">
          {t(
            isForbidden
              ? "errorPage.forbidden.message"
              : "pageAgents.loadError",
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
            {t("pageAgents.retry")}
          </Button>
        )}
      </SettingsCard>
    </div>
  );
}
