import { useState } from "react";

import type { ProjectIntegration } from "@/definition/Project";

/** The settings the GitHub panel lets a visitor edit. */
export interface GitHubFormValues {
  readonly repoUrl: string;
  /** Token typed by the visitor; empty keeps the stored secret. */
  readonly token: string;
  readonly syncIssues: boolean;
  readonly syncPullRequests: boolean;
  readonly allowCreateIssues: boolean;
  readonly allowCreatePullRequests: boolean;
  readonly syncIntervalMinutes: string;
}

/** Changes one setting of the panel. */
export type GitHubValueChange = <Key extends keyof GitHubFormValues>(
  key: Key,
  value: GitHubFormValues[Key],
) => void;

/** The editable settings and whether they differ from the stored ones. */
export interface GitHubFormState {
  readonly values: GitHubFormValues;
  readonly isDirty: boolean;
  readonly change: GitHubValueChange;
}

const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

const SETTING_KEYS = [
  "repoUrl",
  "syncIssues",
  "syncPullRequests",
  "allowCreateIssues",
  "allowCreatePullRequests",
  "syncIntervalMinutes",
] as const;

/**
 * Reads the stored settings, or the defaults for a project without a
 * GitHub integration.
 *
 * @param integration - The stored integration, if there is one.
 */
function initialGitHubValues(
  integration: ProjectIntegration | null,
): GitHubFormValues {
  const allowsPushing = integration
    ? integration.syncDirection !== "pull"
    : true;

  return {
    allowCreateIssues: allowsPushing,
    allowCreatePullRequests: allowsPushing,
    repoUrl: integration?.repoUrl ?? "",
    syncIntervalMinutes: String(
      integration?.syncIntervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES,
    ),
    syncIssues: integration?.syncIssues ?? true,
    syncPullRequests: integration?.syncPullRequests ?? true,
    token: "",
  };
}

/**
 * Keeps the settings of the GitHub panel.
 *
 * @param integration - The stored integration, if there is one.
 */
export function useGitHubFormValues(
  integration: ProjectIntegration | null,
): GitHubFormState {
  const [values, setValues] = useState(() => initialGitHubValues(integration));
  // Compared with the current integration, so a saved panel is clean again.
  const initial = initialGitHubValues(integration);

  const change: GitHubValueChange = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const isDirty =
    values.token.trim() !== "" ||
    SETTING_KEYS.some((key) => values[key] !== initial[key]);

  return { change, isDirty, values };
}
