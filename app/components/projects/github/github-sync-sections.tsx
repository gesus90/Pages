import { useTranslation } from "react-i18next";

import { ToggleRow } from "@/app/components/projects/integration-fields";
import { Select } from "@/app/components/ui/select";

import type { GitHubFormValues, GitHubValueChange } from "./github-form-values";

interface GitHubSyncSectionsProps {
  readonly values: GitHubFormValues;
  readonly onChange: GitHubValueChange;
}

const INTERVAL_MINUTES = [5, 15, 30, 60] as const;

/** The switches for what is synchronised and what Pages may create on GitHub. */
export function GitHubSyncSections({
  values,
  onChange,
}: GitHubSyncSectionsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectDetail.integrations.sync")}
        </h3>
        <ToggleRow
          checked={values.syncIssues}
          hint={t("projectDetail.interfaces.syncIssuesHint")}
          onChange={(checked) => onChange("syncIssues", checked)}
          title={t("projectDetail.integrations.syncIssues")}
        />
        <ToggleRow
          checked={values.syncPullRequests}
          hint={t("projectDetail.interfaces.syncPullRequestsHint")}
          onChange={(checked) => onChange("syncPullRequests", checked)}
          title={t("projectDetail.integrations.syncPullRequests")}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectDetail.interfaces.createFromPages")}
        </h3>
        <ToggleRow
          checked={values.allowCreateIssues}
          hint={t("projectDetail.interfaces.allowCreateIssuesHint")}
          onChange={(checked) => onChange("allowCreateIssues", checked)}
          title={t("projectDetail.interfaces.allowCreateIssues")}
        />
        <ToggleRow
          checked={values.allowCreatePullRequests}
          hint={t("projectDetail.interfaces.allowCreatePullRequestsHint")}
          onChange={(checked) => onChange("allowCreatePullRequests", checked)}
          title={t("projectDetail.interfaces.allowCreatePullRequests")}
        />
      </section>
    </>
  );
}

/** The sync interval of the scheduled runs. */
export function GitHubIntervalField({
  syncIntervalMinutes,
  onIntervalChange,
}: {
  readonly syncIntervalMinutes: string;
  readonly onIntervalChange: (minutes: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const intervalOptions = [
    { label: t("projectDetail.integrations.intervalManual"), value: "0" },
    ...INTERVAL_MINUTES.map((count) => ({
      label: t("projectDetail.integrations.intervalMinutes", { count }),
      value: String(count),
    })),
  ];

  return (
    <section className="flex flex-col gap-1.5">
      <span className="select-none text-xs font-semibold text-foreground">
        {t("projectDetail.integrations.interval")}
      </span>
      <Select
        ariaLabel={t("projectDetail.integrations.interval")}
        className="w-full"
        onValueChange={onIntervalChange}
        options={intervalOptions}
        value={syncIntervalMinutes}
      />
    </section>
  );
}
