import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

/** Explicit recovery and catalog actions; CLI login always stays on the remote host. */
export function RunnerMaintenance({
  connection,
}: {
  readonly connection: RunnerConnectionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    readonly ok: boolean;
    readonly grant?: string;
  }>();
  const isPending = fetcher.state !== "idle";
  return (
    <div className="mt-2 max-w-80 space-y-2 text-xs">
      <p className="text-muted-foreground">
        {t("settings.agents.runner.loginRemote")}
      </p>
      <fetcher.Form
        method="post"
        action="/settings-api/runners"
        className="flex flex-wrap gap-2"
      >
        <input
          type="hidden"
          name="connectionId"
          value={connection.connectionId}
        />
        <input type="hidden" name="provider" value="openrouter" />
        {connection.runnerId ? (
          <Button
            size="sm"
            variant="outline"
            type="submit"
            name="intent"
            value="revoke"
            disabled={isPending}
          >
            {t("settings.agents.runner.revoke")}
          </Button>
        ) : null}
        {!connection.runnerId && connection.isStable ? (
          <Button
            size="sm"
            variant="outline"
            type="submit"
            name="intent"
            value="authorize"
            disabled={isPending}
          >
            {t("settings.agents.runner.authorize")}
          </Button>
        ) : null}
        {connection.isOnline ? (
          <>
            <Button
              size="sm"
              variant="outline"
              type="submit"
              name="intent"
              value="refresh-tools"
              disabled={isPending}
            >
              {t("settings.agents.runner.refreshTools")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="submit"
              name="intent"
              value="sync-provider"
              disabled={isPending}
            >
              {t("settings.agents.runner.syncCatalog")}
            </Button>
          </>
        ) : null}
      </fetcher.Form>
      {connection.isOnline ? (
        <RunnerProviderKey connectionId={connection.connectionId} />
      ) : null}
      {fetcher.data?.grant ? (
        <label className="block space-y-1">
          {t("settings.agents.runner.grant")}
          <Input
            type="password"
            readOnly
            value={fetcher.data.grant}
            autoComplete="off"
          />
        </label>
      ) : null}
      {fetcher.data && !fetcher.data.ok ? (
        <p role="status">{t("settings.agents.runner.catalogRecovery")}</p>
      ) : null}
    </div>
  );
}

function RunnerProviderKey({
  connectionId,
}: {
  readonly connectionId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  return (
    <details>
      <summary className="cursor-pointer">
        {t("settings.agents.runner.storeKey")}
      </summary>
      <fetcher.Form
        method="post"
        action="/settings-api/runners"
        className="mt-2 space-y-2"
      >
        <input type="hidden" name="connectionId" value={connectionId} />
        <input type="hidden" name="provider" value="openrouter" />
        <label className="block">
          {t("settings.agents.runner.apiKey")}
          <Input
            name="apiKey"
            type="password"
            autoComplete="off"
            required
            minLength={16}
          />
        </label>
        <Button
          type="submit"
          name="intent"
          value="store-provider-key"
          size="sm"
          variant="outline"
          disabled={fetcher.state !== "idle"}
        >
          {t("settings.agents.runner.storeKey")}
        </Button>
      </fetcher.Form>
      {fetcher.data ? (
        <p role="status">
          {t(
            fetcher.data.ok
              ? "settings.agents.runner.catalogSynced"
              : "settings.agents.runner.catalogRecovery",
          )}
        </p>
      ) : null}
    </details>
  );
}
