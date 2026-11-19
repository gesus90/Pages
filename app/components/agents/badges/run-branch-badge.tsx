import { GitBranch, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentSessionRunBranch } from "@/definition/AgentPlanRunBranch";
import type { AgentSessionGitState } from "@/definition/AgentSessionJournal";

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

function branchWarning(
  branch: AgentSessionRunBranch,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  const { expected, actual, check } = branch;
  if (!expected) return null;
  if (check !== "matches" && actual.state !== "unreadable")
    return gitStateText(actual, t);
  if (expected.state === "mismatch")
    return t("agentBadges.branch.preparationMismatch", {
      observed: gitStateText(expected.observed, t),
    });
  return null;
}

/**
 * Shows the prepared run branch or the branch recorded by the attempt.
 * A differing Git state is available on the badge in the same sidebar row.
 */
export function RunBranchBadge({
  branch,
}: {
  readonly branch: AgentSessionRunBranch;
}): React.ReactElement {
  const { t } = useTranslation();
  const { expected, actual } = branch;
  const name =
    expected?.branch ?? (actual.state === "branch" ? actual.branch : null);
  const warning = branchWarning(branch, t);
  const title = warning && name ? `${name} · ${warning}` : (name ?? undefined);
  return (
    <span
      data-run-branch={branch.check}
      title={title}
      className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-[7px] border border-plan-parameter bg-plan-parameter-subtle px-2 text-[11px] leading-4 font-semibold text-plan-parameter"
    >
      <GitBranch aria-hidden="true" className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
      {warning ? (
        <TriangleAlert
          aria-label={warning}
          className="size-3 shrink-0 text-warning"
          role="img"
        />
      ) : null}
    </span>
  );
}
