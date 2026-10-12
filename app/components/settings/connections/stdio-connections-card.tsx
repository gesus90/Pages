import { KeyRound, Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { TokenDurationForm } from "./token-duration-form";
import { StdioConnectionsTable } from "./stdio-connections-table";

import type { RefObject } from "react";
import type { PersonalAgentToken } from "@/definition/McpAuthorization";
import type { ConnectionAction } from "./connection-action";

/** Groups personal stdio preferences, active credentials and retained ended entries. */
export function StdioConnectionsCard({
  tokens,
  days,
  pending,
  onGuide,
  onAction,
  onValidity,
  endedRef,
}: {
  readonly tokens: readonly PersonalAgentToken[];
  readonly days: number;
  readonly pending: boolean;
  readonly onGuide: () => void;
  readonly onAction: (action: ConnectionAction) => void;
  readonly onValidity: (days: string) => void;
  readonly endedRef: RefObject<HTMLButtonElement | null>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const active = tokens.filter((token) => token.status === "active");
  const ended = tokens.filter((token) => token.status !== "active");
  return (
    <SettingsCard
      icon={<KeyRound className="size-4" />}
      title={t("settings.connections.stdio.title")}
      description={t("settings.connections.stdio.description")}
      wrapHeader
      action={
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 xl:min-h-9"
          onClick={onGuide}
        >
          {t("settings.connections.stdio.pair")}
        </Button>
      }
    >
      <TokenDurationForm
        days={days}
        pending={pending}
        onValidity={onValidity}
      />
      {active.length > 0 ? (
        <StdioConnectionsTable tokens={active} onAction={onAction} />
      ) : (
        <div className="space-y-2 text-sm">
          <Plug className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">
            {t("settings.connections.stdio.empty.title")}
          </p>
          <p className="text-muted-foreground">
            {t("settings.connections.stdio.empty.description")}
          </p>
          <Button variant="link" className="min-h-11" onClick={onGuide}>
            {t("settings.connections.stdio.empty.action")}
          </Button>
        </div>
      )}
      {ended.length > 0 ? (
        <div className="mt-5">
          <button
            type="button"
            ref={endedRef}
            className={buttonVariants({ variant: "ghost" })}
            aria-expanded={expanded}
            aria-controls="ended-connections"
            onClick={() => setExpanded(!expanded)}
          >
            {t("settings.connections.stdio.ended", { count: ended.length })}
          </button>
          <div id="ended-connections" hidden={!expanded}>
            <StdioConnectionsTable tokens={ended} onAction={onAction} />
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
}
