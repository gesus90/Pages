import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { ToggleRow } from "@/app/components/projects/integration-fields";

interface GitHubSyncSwitchProps {
  readonly isEnabled: boolean;
}

/** Switches the synchronization of the project on or off without touching token or repository. */
export function GitHubSyncSwitch({
  isEnabled,
}: GitHubSyncSwitchProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();

  function handleChange(nextEnabled: boolean): void {
    void submit(
      {
        intent: "set-integration-sync",
        syncEnabled: nextEnabled ? "on" : "",
      },
      { method: "post" },
    );
  }

  return (
    <ToggleRow
      checked={isEnabled}
      hint={t("projectDetail.integrations.syncEnabledHint")}
      onChange={handleChange}
      title={t("projectDetail.integrations.syncEnabled")}
    />
  );
}
