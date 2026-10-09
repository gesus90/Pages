import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { isLoginActive } from "@/definition/AgentConnection";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";

export type AgentCommand = "auth" | "model" | "login" | "logout" | "delete";
export type AgentCommandHandler = (
  connection: AgentConnectionSummary,
  command: AgentCommand,
) => void;

/** Gives every connection explicit check and destructive actions. */
export function AgentRowMenu({
  connection,
  disabled,
  onEdit,
  onCommand,
}: {
  readonly connection: AgentConnectionSummary;
  readonly disabled: boolean;
  readonly onEdit: (connection: AgentConnectionSummary) => void;
  readonly onCommand: AgentCommandHandler;
}): React.ReactElement {
  const { t } = useTranslation();
  const isBusy =
    disabled ||
    Boolean(connection.cli?.login && isLoginActive(connection.cli.login.state));
  const canUseCli = connection.cli?.binaryFound;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("settings.agents.actionsFor", {
            name: connection.name,
          })}
          id={`agent-menu-${connection.id}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(connection)}>
          {t("settings.agents.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isBusy || canUseCli === false}
          onSelect={() => onCommand(connection, "auth")}
        >
          {t(
            connection.cli
              ? "settings.agents.checkLogin"
              : "settings.agents.checkAccess",
          )}
        </DropdownMenuItem>
        {canUseCli ? (
          <DropdownMenuItem
            disabled={isBusy}
            onSelect={() => onCommand(connection, "login")}
          >
            {t(
              connection.cli?.loggedInAt
                ? "settings.agents.loginAgain"
                : "settings.agents.loginStart",
            )}
          </DropdownMenuItem>
        ) : null}
        {connection.cli?.loggedInAt ? (
          <DropdownMenuItem
            disabled={isBusy}
            onSelect={() => onCommand(connection, "logout")}
          >
            {t("settings.agents.logout")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="text-destructive"
          disabled={isBusy}
          onSelect={() => onCommand(connection, "delete")}
        >
          {t("settings.agents.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
