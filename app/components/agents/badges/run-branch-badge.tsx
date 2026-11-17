import { GitBranch, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentSessionRunBranch } from "@/definition/AgentPlanRunBranch";
import type { AgentSessionGitState } from "@/definition/AgentSessionJournal";

const PILL_CLASS =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[7px] border px-2 font-mono text-xs leading-none font-semibold";

function WarningBadge({ text }: { readonly text: string }): React.ReactElement {
  return (
    <span
      data-run-branch-warning
      className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[7px] border border-warning bg-warning-subtle px-2 text-[11px] leading-none font-semibold text-warning"
    >
      <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

/** The word for a Git state that differs from the run branch; `null` for a matching one. */
function actualText(
  branch: AgentSessionRunBranch,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  const { actual, check } = branch;
  if (check === "matches") return null;
  if (actual.state === "branch")
    return t("agentBadges.branch.checkedOut", { branch: actual.branch });
  if (actual.state === "detached")
    return t("agentBadges.branch.detached", {
      commit: actual.commit.slice(0, 12),
    });
  if (actual.state === "no_repository")
    return t("agentBadges.branch.noRepository");
  return t("agentBadges.branch.unreadable");
}

function gitStateText(
  state: AgentSessionGitState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (state.state === "branch")
    return t("agentBadges.branch.checkedOut", { branch: state.branch });
  if (state.state === "detached")
    return t("agentBadges.branch.detached", {
      commit: state.commit.slice(0, 12),
    });
  if (state.state === "no_repository")
    return t("agentBadges.branch.noRepository");
  return t("agentBadges.branch.unreadable");
}

/** The preparation declared another branch than it left checked out; its own target stays. */
function PreparationNote({
  branch,
}: {
  readonly branch: NonNullable<AgentSessionRunBranch["expected"]>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (branch.state !== "mismatch") return null;
  return (
    <span className="text-[11px] text-muted-foreground">
      {t("agentBadges.branch.preparationMismatch", {
        observed: gitStateText(branch.observed, t),
      })}
    </span>
  );
}

/**
 * The run branch of a session's workspace and how its Git state stands now.
 * @remarks
 * The branch is a value of the run, so it uses the violet of plan parameters,
 * with a 1 px solid border in the same color like every agent badge.
 * The workspace stands below it. A Git state that differs adds a warning badge
 * with text and never replaces the target; detached HEAD, a missing
 * repository and an unreadable state are named apart. Without a run branch
 * the badge says so and only names the state Pages read. Showing the badge
 * never checks anything out.
 */
export function RunBranchBadge({
  branch,
  workspaceName,
}: {
  readonly branch: AgentSessionRunBranch;
  /** The name of the workspace when the run branch does not carry one. */
  readonly workspaceName: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { expected } = branch;
  const workspace = expected?.workspaceName ?? workspaceName;
  const difference = actualText(branch, t);
  return (
    <div
      data-run-branch={branch.check}
      className="flex min-w-0 flex-col items-end gap-1 text-right"
    >
      {expected ? (
        <span
          title={expected.branch}
          className={cn(
            PILL_CLASS,
            "border-plan-parameter bg-plan-parameter-subtle text-plan-parameter",
          )}
        >
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{expected.branch}</span>
        </span>
      ) : (
        <span
          className={cn(
            PILL_CLASS,
            "border-border bg-muted font-normal text-muted-foreground",
          )}
        >
          {t("agentBadges.branch.missing")}
        </span>
      )}
      {expected && difference ? <WarningBadge text={difference} /> : null}
      {!expected && branch.actual.state !== "branch" && difference ? (
        <WarningBadge text={difference} />
      ) : null}
      {!expected && branch.actual.state === "branch" ? (
        <span className="text-[11px] text-muted-foreground">
          {gitStateText(branch.actual, t)}
        </span>
      ) : null}
      {expected ? <PreparationNote branch={expected} /> : null}
      {workspace ? (
        <span className="max-w-full truncate text-[11px] text-muted-foreground">
          {t("agentBadges.branch.workspace", { name: workspace })}
        </span>
      ) : null}
    </div>
  );
}
