import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import type { ConnectionAction } from "./connection-action";
import type { PersonalAgentToken } from "@/definition/McpAuthorization";

/** Uses the existing keyboard-accessible row menu for paired and legacy tokens. */
export function ConnectionMenu({
  token,
  onAction,
}: {
  readonly token: PersonalAgentToken;
  readonly onAction: (action: ConnectionAction) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("settings.connections.menu.label", {
            name: token.name,
          })}
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {token.source === "pairing" && token.rotationRequestedAt === null ? (
          <DropdownMenuItem
            onSelect={() =>
              onAction({
                intent: "request-rotation",
                id: token.id,
                name: token.name,
              })
            }
          >
            {t("settings.connections.menu.rotate")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() =>
            onAction({ intent: "revoke-token", id: token.id, name: token.name })
          }
        >
          {t("settings.connections.menu.revoke")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
