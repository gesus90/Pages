import { useTranslation } from "react-i18next";

import { AccessBadge } from "@/app/components/agents/badges/access-badge";
import { ModelBadge } from "@/app/components/agents/badges/model-badge";
import { ReasoningBadge } from "@/app/components/agents/badges/reasoning-badge";
import {
  RunBranchBadge,
  RunBranchNoteValue,
  runBranchNote,
} from "@/app/components/agents/badges/run-branch-badge";
import { openCodeSourceName } from "@/app/components/agents/model-picker/model-catalog";

import { RowBadge, SidebarRow } from "./console-sidebar-parts";

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
          <RowBadge>
            <RunBranchBadge branch={runBranch} />
          </RowBadge>
        ) : (
          <UnknownValue text={unknown} />
        )}
      </SidebarRow>
      {note ? (
        <SidebarRow label={t(`${key}.gitState`)}>
          <RowBadge>
            <RunBranchNoteValue note={note} />
          </RowBadge>
        </SidebarRow>
      ) : null}
    </>
  );
}

/**
 * Model, reasoning, access and branch of a Claude Code, Codex, Antigravity,
 * OpenCode or direct Z.AI session as the shared badges, one 36 px row each.
 * @remarks
 * The model and the reasoning are the structured values of the session view:
 * confirmed ones as confirmed, requested ones as requested. An OpenCode
 * model names its known source, such as OpenCode Zen, in the tooltip. A
 * reasoning level nobody named stays "default of the model" and never reads
 * as `none` or a confirmed `medium`.
 */
export function BadgeSessionFacts({
  step,
  view,
  vendor,
}: {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
  /** The vendor or tool of the model badge, such as `openai` or `opencode`. */
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
          <RowBadge>
            <ModelBadge
              vendor={vendor}
              name={modelIdentity.name}
              status={modelIdentity.status}
              source={openCodeSourceName(
                view.provider,
                modelIdentity.modelId,
                t,
              )}
            />
          </RowBadge>
        ) : (
          <UnknownValue text={unknown} />
        )}
      </SidebarRow>
      <SidebarRow label={t(`${key}.reasoning`)}>
        {reasoning?.value && reasoning.status !== "unknown" ? (
          <RowBadge>
            <ReasoningBadge
              level={reasoning.value}
              status={reasoning.status}
              isOffered={reasoning.isOffered}
            />
          </RowBadge>
        ) : (
          <UnknownValue text={t("agentBadges.reasoning.default")} />
        )}
      </SidebarRow>
      <SidebarRow label={t(`${key}.access`)}>
        {access ? (
          <RowBadge>
            <AccessBadge access={access} />
          </RowBadge>
        ) : (
          <UnknownValue text={unknown} />
        )}
      </SidebarRow>
      <BranchFacts view={view} unknown={unknown} />
    </>
  );
}
