import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { AgentCheckTime } from "./agent-check-time";

import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

interface RunnerActionResult {
  readonly ok: boolean;
  readonly intent?: string;
  readonly path?: string;
}

function runnerStatus(connection: RunnerConnectionView): string {
  if (connection.runnerId) return connection.isOnline ? "online" : "registered";
  return connection.isStable ? "missing" : "waiting";
}

/** Renders actual SSH registrations without inventing installed providers or accounts. */
export function RunnerConnectionRow({
  connection,
}: {
  readonly connection: RunnerConnectionView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <tr className="border-b border-border/60 align-top last:border-0">
      <th scope="row" className="px-3 py-3 font-medium">
        {connection.name}
        <span className="block text-xs font-normal break-all text-muted-foreground">
          {connection.endpoint}
        </span>
      </th>
      <td className="px-3 py-3 whitespace-nowrap">
        {connection.runnerId ? t("settings.agents.runner.tool") : "—"}
      </td>
      <td className="px-3 py-3">{connection.departmentName ?? "—"}</td>
      <td className="px-3 py-3">
        <span
          className={
            connection.isOnline ? "text-success" : "text-muted-foreground"
          }
        >
          {t(`settings.agents.runner.${runnerStatus(connection)}`)}
        </span>
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground">
        <AgentCheckTime checkedAt={connection.checkedAt} />
      </td>
      <td className="min-w-40 px-3 py-3">
        <RunnerActions connection={connection} />
      </td>
    </tr>
  );
}

function RunnerActions({
  connection,
}: {
  readonly connection: RunnerConnectionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RunnerActionResult>();
  const isPending = fetcher.state !== "idle";
  const canSetup = connection.isStable && connection.runnerId === null;
  return (
    <div className="max-w-64 space-y-2">
      <fetcher.Form method="post" action="/settings-api/runners">
        <input
          type="hidden"
          name="connectionId"
          value={connection.connectionId}
        />
        {canSetup ? (
          <Button
            type="submit"
            size="sm"
            variant="outline"
            name="intent"
            value="transfer"
            disabled={isPending}
          >
            {t("settings.agents.runner.setup")}
          </Button>
        ) : null}
        {!connection.isStable ? (
          <Button
            type="submit"
            size="sm"
            variant="outline"
            name="intent"
            value="connect"
            disabled={isPending}
          >
            {t("settings.agents.runner.connect")}
          </Button>
        ) : null}
      </fetcher.Form>
      {canSetup ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.runner.transferOnly")}
        </p>
      ) : null}
      {fetcher.data ? (
        <p role="status" className="text-xs break-words text-muted-foreground">
          {t(
            fetcher.data.ok
              ? `settings.agents.runner.${fetcher.data.intent === "transfer" ? "transferred" : "connected"}`
              : "settings.agents.runner.failed",
            { path: fetcher.data.path },
          )}
        </p>
      ) : null}
    </div>
  );
}
