import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FieldLabel } from "@/app/components/projects/integration-fields";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

interface GitHubRepositoryFieldProps {
  readonly repoUrl: string;
  readonly onRepoUrlChange: (repoUrl: string) => void;
}

const DEFAULT_BRANCH = "main";

const BRANCH_OPTIONS = ["main", "master", "develop"].map((branch) => ({
  label: branch,
  value: branch,
}));

/** The repository address and branch of the GitHub panel. */
export function GitHubRepositoryField({
  repoUrl,
  onRepoUrlChange,
}: GitHubRepositoryFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const [branch, setBranch] = useState(DEFAULT_BRANCH);

  function handleRepoUrlChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    onRepoUrlChange(event.currentTarget.value);
  }

  return (
    <section className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel htmlFor="github-repo">
          {t("projectDetail.interfaces.repositoryLabel")}
        </FieldLabel>
        <Input
          autoComplete="off"
          className="h-10 text-sm xl:h-10 xl:text-sm"
          id="github-repo"
          name="repoUrl"
          onChange={handleRepoUrlChange}
          placeholder={t("projectDetail.integrations.repoPlaceholder")}
          type="url"
          value={repoUrl}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-semibold text-foreground">
          {t("projectDetail.interfaces.branchLabel")}
        </span>
        <Select
          ariaLabel={t("projectDetail.interfaces.branchLabel")}
          className="w-full"
          onValueChange={setBranch}
          options={BRANCH_OPTIONS}
          value={branch}
        />
      </div>
    </section>
  );
}
