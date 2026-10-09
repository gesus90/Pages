import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { AgentCheckResults } from "./agent-check-results";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentCommandHandler } from "./agent-row-menu";

/** Exposes two explicit checks, requiring saved input and confirmation for inference. */
export function AgentChecks({
  connection,
  disabled,
  isChecking,
  onCommand,
}: {
  readonly connection: AgentConnectionSummary;
  readonly disabled: boolean;
  readonly isChecking: boolean;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement {
  const { t } = useTranslation();
  const standardHint = connection.cli ? "cliAuthHint" : "apiAuthHint";
  const authHint = connection.provider === "zai" ? "zaiAuthHint" : standardHint;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t("settings.agents.checks")}</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          isPending={isChecking}
          onClick={() => onCommand(connection, "auth")}
        >
          {t(
            connection.cli
              ? "settings.agents.checkLogin"
              : "settings.agents.checkAccess",
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || (!connection.cli && !connection.testModel)}
          isPending={isChecking}
          onClick={() => onCommand(connection, "model")}
        >
          {t(
            connection.cli
              ? "settings.agents.testCli"
              : "settings.agents.testModelAction",
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`settings.agents.${authHint}`)}
      </p>
      {!connection.cli && !connection.testModel ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.modelRequiredHint")}
        </p>
      ) : null}
      <AgentCheckResults
        kind="auth"
        check={connection.checks.auth}
        isCli={Boolean(connection.cli)}
      />
      <AgentCheckResults
        kind="model"
        check={connection.checks.model}
        isCli={Boolean(connection.cli)}
      />
    </section>
  );
}
