import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  RUNNER_RELEASE,
  SUPPORTED_RUNNER_RELEASES,
} from "@/definition/RunnerMaintenance";

import type {
  RunnerSettings,
  RunnerMaintenanceReceipt,
} from "@/definition/RunnerMaintenance";
import type { RunnerConnectionView } from "@/definition/RunnerProtocol";

interface RunnerSettingsResponse {
  readonly settings: RunnerSettings;
  readonly states: Readonly<
    Record<
      string,
      {
        readonly requested: boolean;
        readonly receipt: RunnerMaintenanceReceipt | null;
      }
    >
  >;
}

/** Administrator controls use the same maintenance endpoint for this server and remote runners. */
export function RunnerUpdateSettings({
  connections,
}: {
  readonly connections: readonly RunnerConnectionView[];
}): React.ReactElement {
  const fetcher = useFetcher<RunnerSettingsResponse>();
  const { load } = fetcher;
  useEffect(() => {
    void load("/settings-api/runners?configuration=1");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        void load("/settings-api/runners?configuration=1");
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3">
      {fetcher.data ? (
        <RunnerAddressForm settings={fetcher.data.settings} />
      ) : null}
      {connections
        .filter((entry) => entry.runnerId)
        .map((connection) => (
          <RunnerUpdateControl
            key={connection.connectionId}
            connection={connection}
            state={fetcher.data?.states[connection.connectionId]}
          />
        ))}
    </div>
  );
}

function RunnerAddressForm({
  settings,
}: {
  readonly settings: RunnerSettings;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const [allowInsecureLan, setAllowInsecureLan] = useState(
    settings.allowInsecureLan,
  );
  return (
    <fetcher.Form
      method="post"
      action="/settings-api/runners"
      className="space-y-2 text-sm"
    >
      <input type="hidden" name="intent" value="runner-settings" />
      <label className="block space-y-1">
        {t("settings.agents.runner.updates.address")}
        <Input
          name="address"
          defaultValue={settings.address ?? ""}
          placeholder="wss://pages.example.org"
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="allowInsecureLan"
          checked={allowInsecureLan}
          onChange={(event) => setAllowInsecureLan(event.target.checked)}
        />
        {t("settings.agents.runner.updates.lan")}
      </label>
      {allowInsecureLan ? (
        <p role="alert" className="text-warning">
          {t("settings.agents.runner.updates.warning")}
        </p>
      ) : null}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="automaticUpdates"
          defaultChecked={settings.automaticUpdates}
        />
        {t("settings.agents.runner.updates.automatic")}
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={fetcher.state !== "idle"}
      >
        {t("settings.agents.runner.updates.save")}
      </Button>
      {fetcher.data ? (
        <p role="status">
          {t(
            `settings.agents.runner.updates.${fetcher.data.ok ? "saved" : "saveFailed"}`,
          )}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

function RunnerUpdateControl({
  connection,
  state,
}: {
  readonly connection: RunnerConnectionView;
  readonly state: RunnerSettingsResponse["states"][string] | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const isSupported = SUPPORTED_RUNNER_RELEASES.includes(
    connection.runnerVersion ?? "",
  );
  return (
    <fetcher.Form
      method="post"
      action="/settings-api/runners"
      className="space-y-1 text-xs"
    >
      <input type="hidden" name="intent" value="runner-update" />
      <input
        type="hidden"
        name="connectionId"
        value={connection.connectionId}
      />
      <p>
        {connection.isLocal
          ? t("settings.agents.runner.thisServer")
          : connection.name}
        : {connection.runnerVersion ?? "—"} → {RUNNER_RELEASE}
      </p>
      {!isSupported ? (
        <p className="text-warning">
          {t("settings.agents.runner.updates.required")}
        </p>
      ) : null}
      {state?.receipt ? (
        <p role="status">
          {t(`settings.agents.runner.updates.status.${state.receipt.status}`)}
          {state.receipt.reason
            ? `: ${t(`settings.agents.runner.updates.reason.${state.receipt.reason}`)}`
            : ""}
        </p>
      ) : (
        <p>{t("settings.agents.runner.updates.bootstrap")}</p>
      )}
      {state?.requested ? (
        <p role="status">{t("settings.agents.runner.updates.requested")}</p>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={
          fetcher.state !== "idle" ||
          connection.runnerVersion === RUNNER_RELEASE
        }
      >
        {t("settings.agents.runner.updates.update")}
      </Button>
      {fetcher.data?.ok === false ? (
        <p role="status">{t("settings.agents.runner.updates.saveFailed")}</p>
      ) : null}
    </fetcher.Form>
  );
}
