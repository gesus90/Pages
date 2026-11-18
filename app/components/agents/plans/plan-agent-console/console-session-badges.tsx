import { useTranslation } from "react-i18next";

import { AccessBadge } from "@/app/components/agents/badges/access-badge";
import { ModelBadge } from "@/app/components/agents/badges/model-badge";
import { ReasoningBadge } from "@/app/components/agents/badges/reasoning-badge";
import {
  RunBranchBadge,
  RunBranchNoteValue,
  runBranchNote,
} from "@/app/components/agents/badges/run-branch-badge";

import { SidebarRow } from "./console-sidebar-parts";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ModelBadgeVendor } from "@/definition/AgentModelIdentity";
import type { AgentSessionView } from "@/definition/AgentSessionJournal";

function UnknownValue({ text }: { readonly text: string }): React.ReactElement {
  return <span className="min-w-0 truncate">{text}</span>;
}

/**
 * The name of the workspace: the one the run branch carries, else the last
 * folder of the workspace path.
 * @param view - The session view.
 * @returns The name, or `null` when the session names no workspace.
 */
export function workspaceName(view: AgentSessionView): string | null {
  const named = view.runBranch?.expected?.workspaceName;
  if (named) return named;
  const directory = view.workspace?.directory;
  if (!directory) return null;
  return directory.split("/").filter(Boolean).at(-1) ?? null;
}

/** The branch row and, only when the Git state differs, a row that says how. */
function BranchFacts({
  view,
  unknown,
}: {
  readonly view: AgentSessionView;
  readonly unknown: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const { runBranch } = view;
  const note = runBranch ? runBranchNote(runBranch, t) : null;
  return (
    <>
      <SidebarRow label={t(`${key}.branch`)}>
        {runBranch ? (
          <RunBranchBadge branch={runBranch} />
        ) : (
          <UnknownValue text={unknown} />
        )}
      </SidebarRow>
      {note ? (
        <SidebarRow label={t(`${key}.gitState`)}>
          <RunBranchNoteValue note={note} />
        </SidebarRow>
      ) : null}
    </>
  );
}

/**
 * Model, reasoning, access and branch of a Claude Code, Codex or Antigravity
 * session as the shared badges, one 36 px row each.
 * @remarks
 * The model and the reasoning are the structured values of the session view:
 * confirmed ones as confirmed, requested ones as requested. A reasoning level
 * nobody named stays "default of the model" and never reads as `none` or a
 * confirmed `medium`.
 */
export function BadgeSessionFacts({
  step,
  view,
  vendor,
}: {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
  /** The vendor the model badge names, such as `openai` for Codex or `antigravity`. */
  readonly vendor: ModelBadgeVendor;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const access = step.session?.requested.options?.access;
  const { modelIdentity, reasoning } = view;
  return (
    <>
      <SidebarRow label={t(`${key}.model`)}>
        {modelIdentity ? (
          <ModelBadge
            vendor={vendor}
            name={modelIdentity.name}
            status={modelIdentity.status}
          />
        ) : (
          <UnknownValue text={unknown} />
        )}
      </SidebarRow>
      <SidebarRow label={t(`${key}.reasoning`)}>
        {reasoning?.value && reasoning.status !== "unknown" ? (
          <ReasoningBadge
            level={reasoning.value}
            status={reasoning.status}
            isOffered={reasoning.isOffered}
          />
        ) : (
          <UnknownValue text={t("agentBadges.reasoning.default")} />
        )}
      </SidebarRow>
      <SidebarRow label={t(`${key}.access`)}>
        {access ? (
          <AccessBadge access={access} />
        ) : (
          <UnknownValue text={unknown} />
        )}
      </SidebarRow>
      <BranchFacts view={view} unknown={unknown} />
    </>
  );
}
