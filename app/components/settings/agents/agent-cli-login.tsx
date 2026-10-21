import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { isLoginActive } from "@/definition/AgentConnection";

import { AgentAlert } from "./agent-alert";
import { AgentCopyButton } from "./agent-copy-button";
import { AgentLoginChallenge } from "./agent-login-challenge";
import { AgentOpenCodeKey } from "./agent-opencode-key";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentCommandHandler } from "./agent-row-menu";
import type { AgentActions } from "./use-agent-actions";

/** Guides an administrator through the Pages-owned CLI account and terminal fallback. */
export function AgentCliLogin({
  connection,
  disabled,
  actions,
  onCommand,
}: {
  readonly connection: AgentConnectionSummary;
  readonly disabled: boolean;
  readonly actions: AgentActions;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const cli = connection.cli;
  if (!cli) return null;
  if (!cli.binaryFound)
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          {t("settings.agents.cliMissing")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.agents.cliInstallHint")}
        </p>
      </section>
    );
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t("settings.agents.cliLogin")}</h3>
      {cli.login && isLoginActive(cli.login.state) ? (
        <AgentLoginChallenge
          connection={connection}
          login={cli.login}
          actions={actions}
        />
      ) : (
        <>
          {cli.login?.errorCode ? (
            <AgentAlert
              message={t(`settings.agents.error.${cli.login.errorCode}`)}
            />
          ) : null}
          {cli.loggedInAt ? (
            <p className="text-sm text-success">
              {t("settings.agents.loggedInSince", {
                time: formatDateTime(cli.loggedInAt),
              })}{" "}
              {cli.accountLabel}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("settings.agents.cliAccountHint")}
            </p>
          )}
          {connection.provider === "codex_cli" ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.agents.deviceAuthHint")}
            </p>
          ) : null}
          {connection.provider === "opencode" ? (
            <AgentOpenCodeKey
              key={connection.id}
              connection={connection}
              actions={actions}
              disabled={disabled}
            />
          ) : null}
          <LoginButtons
            connection={connection}
            disabled={disabled}
            onCommand={onCommand}
          />
          <TerminalAlternative
            connection={connection}
            terminalCommand={cli.terminalCommand}
            disabled={disabled}
            onCommand={onCommand}
          />
        </>
      )}
    </section>
  );
}

/** Starts the account flow of a CLI, or signs it out; OpenCode takes a key instead. */
function LoginButtons({
  connection,
  disabled,
  onCommand,
}: {
  readonly connection: AgentConnectionSummary;
  readonly disabled: boolean;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement {
  const { t } = useTranslation();
  const cli = connection.cli;
  return (
    <div className="flex flex-wrap gap-2">
      {connection.provider === "opencode" ? null : (
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => onCommand(connection, "login")}
        >
          {t(
            cli?.loggedInAt || cli?.login
              ? "settings.agents.loginAgain"
              : "settings.agents.loginStart",
          )}
        </Button>
      )}
      {cli?.loggedInAt ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onCommand(connection, "logout")}
        >
          {t("settings.agents.logout")}
        </Button>
      ) : null}
    </div>
  );
}

function TerminalAlternative({
  connection,
  terminalCommand,
  disabled,
  onCommand,
}: {
  readonly connection: AgentConnectionSummary;
  readonly terminalCommand: string;
  readonly disabled: boolean;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t("settings.agents.terminalAlternative")}
      </summary>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.terminalHint")}
      </p>
      <ScrollViewport
        as="pre"
        axis="horizontal"
        className="pages-selectable overflow-x-auto rounded-xl bg-muted p-3 text-xs whitespace-pre-wrap break-all"
      >
        {terminalCommand}
      </ScrollViewport>
      <AgentCopyButton
        text={terminalCommand}
        label={t("settings.agents.copyCommand")}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onCommand(connection, "auth")}
      >
        {t("settings.agents.checkLogin")}
      </Button>
    </details>
  );
}
