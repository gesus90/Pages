import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

import type { Project, ProjectIntegration } from "@/definition/Project";

interface GitHubProjectHeaderProps {
  readonly project: Project;
  readonly integration: ProjectIntegration | null;
  readonly isSyncing: boolean;
}

/**
 * Chooses the repository label shown in the project header.
 *
 * @param integration - Sanitized integration settings.
 * @returns The repository name, falling back to the raw address.
 */
function getRepositoryLabel(integration: ProjectIntegration): string {
  if (integration.repoName === null) {
    return integration.repoUrl;
  }

  return integration.repoName;
}

/** Renders the project name, connection state and the manual sync button. */
export function GitHubProjectHeader({
  project,
  integration,
  isSyncing,
}: GitHubProjectHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">
          {project.name}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {integration?.isConnected
            ? `${t("projectDetail.integrations.connected")} · ${getRepositoryLabel(integration)}`
            : t("projectDetail.integrations.notConnected")}
        </p>
        {integration?.lastSyncAt ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("projectDetail.integrations.lastSync")} {integration.lastSyncAt}
          </p>
        ) : null}
      </div>
      {integration?.isConnected ? (
        <Form method="post">
          <input name="intent" type="hidden" value="sync-github-project" />
          <input name="projectId" type="hidden" value={project.id} />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isSyncing}
            type="submit"
            variant="ghost"
          >
            {isSyncing
              ? t("projectDetail.integrations.testing")
              : t("projectDetail.integrations.syncNow")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}
