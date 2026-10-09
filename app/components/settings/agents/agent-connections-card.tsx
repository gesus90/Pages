import { KeyRound, Plus, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import { AgentCheckTime } from "./agent-check-time";
import { AgentRowMenu } from "./agent-row-menu";
import { AgentStatus, latestAgentCheck } from "./agent-status";

import type {
  AgentAccessKind,
  AgentConnectionSummary,
  CliToolLocations,
} from "@/definition/AgentConnection";
import type { AgentCommandHandler } from "./agent-row-menu";

interface AgentConnectionsCardProps {
  readonly kind: AgentAccessKind;
  readonly connections: readonly AgentConnectionSummary[];
  readonly cliTools: CliToolLocations;
  readonly disabled: boolean;
  readonly onAdd: (kind: AgentAccessKind) => void;
  readonly onEdit: (connection: AgentConnectionSummary) => void;
  readonly onCommand: AgentCommandHandler;
}

function CliLocations({
  locations,
}: {
  readonly locations: CliToolLocations;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mb-4 space-y-2 text-xs text-muted-foreground">
      {(["codex_cli", "claude_code"] as const).map((provider) => (
        <p key={provider}>
          <span className="font-medium">
            {t(AGENT_PROVIDERS[provider].labelKey)}:{" "}
          </span>
          <span className="pages-selectable break-all">
            {locations[provider].path ?? t("settings.agents.cliMissing")}
          </span>
        </p>
      ))}
      <p>{t("settings.agents.cliInstallHint")}</p>
    </div>
  );
}

/** Groups one access kind in the existing responsive settings-card and table patterns. */
export function AgentConnectionsCard({
  kind,
  connections,
  cliTools,
  disabled,
  onAdd,
  onEdit,
  onCommand,
}: AgentConnectionsCardProps): React.ReactElement {
  const { t } = useTranslation();
  const isApi = kind === "api_key";
  const titleKey = isApi ? "api" : "cli";
  return (
    <SettingsCard
      wrapHeader
      title={t(`settings.agents.${titleKey}Title`)}
      description={t(`settings.agents.${titleKey}Description`)}
      icon={
        isApi ? (
          <KeyRound className="size-4" aria-hidden="true" />
        ) : (
          <Terminal className="size-4" aria-hidden="true" />
        )
      }
      action={
        <Button variant="outline" size="sm" onClick={() => onAdd(kind)}>
          <Plus className="size-4" aria-hidden="true" />
          {t(`settings.agents.${titleKey}Add`)}
        </Button>
      }
    >
      {!isApi ? <CliLocations locations={cliTools} /> : null}
      {connections.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t(`settings.agents.${titleKey}Empty`)}
        </p>
      ) : (
        <AgentConnectionsTable
          connections={connections}
          disabled={disabled}
          onEdit={onEdit}
          onCommand={onCommand}
        />
      )}
    </SettingsCard>
  );
}

function AgentConnectionsTable({
  connections,
  disabled,
  onEdit,
  onCommand,
}: Pick<
  AgentConnectionsCardProps,
  "connections" | "disabled" | "onEdit" | "onCommand"
>): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {[
              "name",
              "providerLabel",
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
            <tr
              key={connection.id}
              className="border-b border-border/60 last:border-0"
            >
              <th scope="row" className="px-3 py-3">
                <Button
                  variant="ghost"
                  size="xs"
                  className="max-w-64 justify-start truncate"
                  onClick={() => onEdit(connection)}
                >
                  {connection.name}
                </Button>
              </th>
              <td className="px-3 py-3 whitespace-nowrap">
                {t(AGENT_PROVIDERS[connection.provider].labelKey)}
              </td>
              <td className="px-3 py-3">
                <AgentStatus connection={connection} />
              </td>
              <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground">
                <AgentCheckTime
                  checkedAt={latestAgentCheck(connection)?.checkedAt ?? null}
                />
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onEdit(connection)}
                  >
                    {t(
                      connection.cli && !connection.cli.loggedInAt
                        ? "settings.agents.configure"
                        : "settings.agents.edit",
                    )}
                  </Button>
                  <AgentRowMenu
                    connection={connection}
                    disabled={disabled}
                    onEdit={onEdit}
                    onCommand={onCommand}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
