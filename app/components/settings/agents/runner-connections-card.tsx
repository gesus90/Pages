import { useEffect } from "react";
import { Link, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";

import { RunnerConnectionRow } from "./runner-connection-row";

import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

/** Remote registrations share the same overview as API and local CLI connections. */
export function RunnerConnectionsCard({
  connections,
  githubMode,
}: {
  readonly connections: readonly RunnerConnectionView[];
  readonly githubMode: "offline" | "http";
}): React.ReactElement {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!connections.length) return;
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      )
        void revalidator.revalidate();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [connections.length, revalidator]);
  return (
    <SettingsCard
      wrapHeader
      title={t("settings.agents.runner.title")}
      description={t("settings.agents.runner.description")}
      icon={<Terminal className="size-4" aria-hidden="true" />}
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={revalidator.state !== "idle"}
          onClick={() => void revalidator.revalidate()}
        >
          {t("settings.agents.runner.refresh")}
        </Button>
      }
    >
      {connections.length ? (
        <RunnerConnectionsTable connections={connections} />
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("settings.agents.runner.empty")}
        </p>
      )}
      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <Link
          className="inline-block text-sm text-primary-text underline"
          to="/agents/workspaces"
        >
          {t("settings.agents.runner.manage")}
        </Link>
        <p>{t(`settings.agents.runner.${githubMode}`)}</p>
      </div>
    </SettingsCard>
  );
}

function RunnerConnectionsTable({
  connections,
}: {
  readonly connections: readonly RunnerConnectionView[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {[
              "name",
              "providerLabel",
              "scope.column",
              "statusLabel",
              "lastCheck",
              "actions",
            ].map((column) => (
              <th
                key={column}
                className="px-3 py-3 font-medium whitespace-nowrap"
                scope="col"
              >
                {t(`settings.agents.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => (
            <RunnerConnectionRow
              key={connection.connectionId}
              connection={connection}
            />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
