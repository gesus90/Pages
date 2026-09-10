import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getWorkItemGitHubSyncState } from "@/definition/Task";

import type { GitHubSyncState } from "@/definition/Task";

const DOT_STYLES: Record<GitHubSyncState, string> = {
  failed: "bg-red-500",
  pending: "bg-orange-400",
  synced: "bg-emerald-500",
  unlinked: "bg-slate-300",
};

interface GitHubSyncBadgeProps {
  readonly githubIssueNumber: number | null;
  readonly githubConflict: boolean;
  readonly githubLastError: string | null;
  readonly githubLastSyncAt: string | null;
  readonly updatedAt: string;
  readonly isSyncing?: boolean;
}

function getLabelKey(state: GitHubSyncState): string {
  if (state === "synced") {
    return "tasks.github.statusSynced";
  }

  if (state === "pending") {
    return "tasks.github.statusPending";
  }

  if (state === "failed") {
    return "tasks.github.statusFailed";
  }

  return "tasks.github.statusUnlinked";
}

/** Renders the compact GitHub synchronization dot used across ticket surfaces. */
export function GitHubSyncBadge({
  githubIssueNumber,
  githubConflict,
  githubLastError,
  githubLastSyncAt,
  updatedAt,
  isSyncing = false,
}: GitHubSyncBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const state = getWorkItemGitHubSyncState({
    githubConflict,
    githubIssueNumber,
    githubLastError,
    githubLastSyncAt,
    updatedAt,
  });
  const detail =
    state === "failed" && githubLastError
      ? `${t(getLabelKey(state))}: ${githubLastError}`
      : t(getLabelKey(state));

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      title={detail}
    >
      {isSyncing ? (
        <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <span
          className={`size-2 rounded-full ${DOT_STYLES[state]}`}
          aria-hidden="true"
        />
      )}
      {t(getLabelKey(state))}
    </span>
  );
}
