import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { GitHubConnectionCard } from "@/app/components/projects/github/github-connection-card";
import { useGitHubFormValues } from "@/app/components/projects/github/github-form-values";
import { GitHubPanelFooter } from "@/app/components/projects/github/github-panel-footer";
import { GitHubRepositoryField } from "@/app/components/projects/github/github-repository-field";
import {
  GitHubIntervalField,
  GitHubSyncSections,
} from "@/app/components/projects/github/github-sync-sections";
import { GitHubTokenField } from "@/app/components/projects/github/github-token-field";
import { useGitHubSubmission } from "@/app/components/projects/github/use-github-submission";
import { ServiceIdentity } from "@/app/components/projects/integration-fields";
import { PanelShell } from "@/app/components/projects/integration-panel-shell";
import { cn } from "@/app/lib/cn";

import type { ProjectIntegration } from "@/definition/Project";

interface GitHubPanelProps {
  readonly integration: ProjectIntegration | null;
  readonly canWrite: boolean;
  readonly projectId: string;
  readonly onClose: () => void;
}

/** A switch the form posts as `"on"` when set and as an empty value otherwise. */
function toFormFlag(isOn: boolean): string {
  return isOn ? "on" : "";
}

function ReadOnlyGitHubPanel({
  integration,
  onClose,
}: Pick<GitHubPanelProps, "integration" | "onClose">): React.ReactElement {
  const { t } = useTranslation();

  return (
    <PanelShell
      footer={null}
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.githubName")}
    >
      <ServiceIdentity
        connected={integration?.isConnected ?? false}
        description={t("projectDetail.interfaces.githubDescription")}
        id="github"
        name={t("projectDetail.interfaces.githubName")}
      />
      {integration ? (
        <p className="text-xs font-medium text-foreground" role="status">
          {integration.syncEnabled
            ? t("projectDetail.integrations.syncStateOn")
            : t("projectDetail.integrations.syncStateOff")}
        </p>
      ) : null}
      <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {t("projectDetail.interfaces.readOnlyHint")}
      </p>
    </PanelShell>
  );
}

function TestResult({
  testPassed,
}: {
  readonly testPassed: boolean | null;
}): React.ReactElement | null {
  const { t } = useTranslation();

  if (testPassed === null) {
    return null;
  }

  return (
    <p
      className={cn(
        "rounded-xl px-4 py-2.5 text-xs font-medium",
        testPassed
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-destructive",
      )}
      role="status"
    >
      {testPassed
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed")}
    </p>
  );
}

function EditableGitHubPanel({
  integration,
  onClose,
}: Omit<GitHubPanelProps, "canWrite">): React.ReactElement {
  const { t } = useTranslation();
  const { change, isDirty, values } = useGitHubFormValues(integration);
  const submission = useGitHubSubmission();

  const syncDirection =
    values.allowCreateIssues || values.allowCreatePullRequests
      ? "bidirectional"
      : "pull";

  return (
    <PanelShell
      footer={
        <GitHubPanelFooter
          canSave={isDirty}
          isSaving={submission.isSaving}
          isTesting={submission.isTesting}
          onTestSubmit={submission.markTestSubmitted}
        />
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.githubName")}
    >
      <ServiceIdentity
        connected={integration?.isConnected ?? false}
        description={t("projectDetail.interfaces.githubDescription")}
        id="github"
        name={t("projectDetail.interfaces.githubName")}
      />

      <Form
        className="flex flex-col gap-5"
        id="github-integration-form"
        method="post"
        onSubmit={submission.markSaveSubmitted}
      >
        <input name="intent" type="hidden" value="save-integration" />
        <input name="syncDirection" type="hidden" value={syncDirection} />
        <input
          name="syncStatus"
          type="hidden"
          value={toFormFlag(integration?.syncStatus ?? true)}
        />
        <input
          name="syncComments"
          type="hidden"
          value={toFormFlag(integration?.syncComments ?? true)}
        />
        <input
          name="syncIssues"
          type="hidden"
          value={toFormFlag(values.syncIssues)}
        />
        <input
          name="syncPullRequests"
          type="hidden"
          value={toFormFlag(values.syncPullRequests)}
        />
        <input
          name="syncCommits"
          type="hidden"
          value={toFormFlag(integration?.syncCommits ?? true)}
        />
        <input
          name="syncIntervalMinutes"
          type="hidden"
          value={values.syncIntervalMinutes}
        />

        <GitHubTokenField
          hasStoredToken={integration?.hasToken ?? false}
          onTokenChange={(token) => change("token", token)}
          token={values.token}
        />
        <GitHubRepositoryField
          onRepoUrlChange={(repoUrl) => change("repoUrl", repoUrl)}
          repoUrl={values.repoUrl}
        />
        <GitHubSyncSections onChange={change} values={values} />
        <GitHubIntervalField
          onIntervalChange={(minutes) => change("syncIntervalMinutes", minutes)}
          syncIntervalMinutes={values.syncIntervalMinutes}
        />
      </Form>

      <TestResult testPassed={submission.testPassed} />

      {integration ? <GitHubConnectionCard integration={integration} /> : null}
    </PanelShell>
  );
}

/**
 * Renders the GitHub settings panel with token, repository, sync, and footer actions.
 *
 * @remarks
 * The token is never logged or rendered in plain text by default, and the
 * stored secret stays server-side: an empty token field keeps the saved
 * secret. Write toggles for issues and pull requests map onto the stored
 * sync direction, so the server-side permission check keeps applying.
 */
export function GitHubPanel({
  canWrite,
  ...panel
}: GitHubPanelProps): React.ReactElement {
  if (!canWrite) {
    return (
      <ReadOnlyGitHubPanel
        integration={panel.integration}
        onClose={panel.onClose}
      />
    );
  }

  return <EditableGitHubPanel {...panel} />;
}
