import { GitBranch, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentSessionRunBranch } from "@/definition/AgentPlanRunBranch";
import type { AgentSessionGitState } from "@/definition/AgentSessionJournal";

const PILL_CLASS =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-[7px] border px-2 text-[11px] leading-none font-semibold";

function WarningBadge({ text }: { readonly text: string }): React.ReactElement {
  return (
    <span
      data-run-branch-warning
      title={text}
      className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-[7px] border border-warning bg-warning-subtle px-2 text-[11px] leading-none font-semibold text-warning"
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

/** A Git state of the workspace that differs from its run branch, as one line. */
export interface RunBranchNote {
  readonly text: string;
  /** A state that contradicts the run branch, shown as a warning. */
  readonly isWarning: boolean;
}

/**
 * What the run branch badge itself cannot say about the Git state.
 * @param branch - The run branch and the Git state Pages read.
 * @param t - The translation function.
 * @returns A differing checkout, detached HEAD, a missing repository, an
 * unreadable state or a preparation that left another branch as a warning;
 * the checked out branch of a run without a run branch as a plain note;
 * `null` when the badge says everything.
 */
export function runBranchNote(
  branch: AgentSessionRunBranch,
  t: ReturnType<typeof useTranslation>["t"],
): RunBranchNote | null {
  const { expected, actual } = branch;
  const difference = actualText(branch, t);
  if (expected && difference) return { text: difference, isWarning: true };
  if (expected?.state === "mismatch")
    return {
      text: t("agentBadges.branch.preparationMismatch", {
        observed: gitStateText(expected.observed, t),
      }),
      isWarning: true,
    };
  if (expected) return null;
  if (actual.state === "branch")
    return { text: gitStateText(actual, t), isWarning: false };
  return difference ? { text: difference, isWarning: true } : null;
}

/**
 * A Git state that differs from the run branch, as a warning badge or a note.
 */
export function RunBranchNoteValue({
  note,
}: {
  readonly note: RunBranchNote;
}): React.ReactElement {
  if (note.isWarning) return <WarningBadge text={note.text} />;
  return (
    <span title={note.text} className="min-w-0 truncate">
      {note.text}
    </span>
  );
}

/**
 * The run branch of a session's workspace as one badge.
 * @remarks
 * The branch is a value of the run, so it uses the violet of plan parameters,
 * with a 1 px solid border in the same color and the type of every agent
 * badge, no monospace. It is never wider than its column: a long name ends
 * with "…" and stands whole in the tooltip. A Git state that differs is
 * {@link runBranchNote}, shown apart and never instead of the target.
 * Without a run branch the badge says so. Showing the badge never checks
 * anything out.
 */
export function RunBranchBadge({
  branch,
}: {
  readonly branch: AgentSessionRunBranch;
}): React.ReactElement {
  const { t } = useTranslation();
  const { expected } = branch;
  if (!expected)
    return (
      <span
        data-run-branch={branch.check}
        className={cn(
          PILL_CLASS,
          "border-border bg-muted font-normal text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">
          {t("agentBadges.branch.missing")}
        </span>
      </span>
    );
  return (
    <span
      data-run-branch={branch.check}
      title={expected.branch}
      className={cn(
        PILL_CLASS,
        "border-plan-parameter bg-plan-parameter-subtle text-plan-parameter",
      )}
    >
      <GitBranch aria-hidden="true" className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{expected.branch}</span>
    </span>
  );
}
