import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

interface LocalRunnerRefreshProps {
  readonly connection: RunnerConnectionView;
}

/** Refreshes local CLI accounts and installed tools through the authenticated runner channel. */
export function LocalRunnerRefresh({
  connection,
}: LocalRunnerRefreshProps): React.ReactElement | null {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  if (!connection.isOnline) return null;
  return (
    <fetcher.Form method="post" action="/settings-api/runners">
      <input type="hidden" name="intent" value="refresh-tools" />
      <input
        type="hidden"
        name="connectionId"
        value={connection.connectionId}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={fetcher.state !== "idle"}
      >
        {t("settings.agents.runner.refreshTools")}
      </Button>
      {fetcher.data?.ok === false ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t("settings.agents.runner.catalogRecovery")}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
