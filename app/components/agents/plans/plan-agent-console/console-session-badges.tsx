import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { AccessBadge } from "@/app/components/agents/badges/access-badge";
import { ClaudeModelBadge } from "@/app/components/agents/badges/claude-model-badge";
import { ReasoningBadge } from "@/app/components/agents/badges/reasoning-badge";
import { RunBranchBadge } from "@/app/components/agents/badges/run-branch-badge";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentSessionView } from "@/definition/AgentSessionJournal";

/** One row of the session facts whose value is a badge, right aligned. */
function BadgeFact(props: {
  readonly label: string;
  readonly children: React.ReactNode;
  /** Keeps the label at the top for a value of several lines, such as the branch. */
  readonly isTall?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 text-sm",
        props.isTall ? "items-start" : "items-center",
      )}
    >
      <dt className="shrink-0 text-agent-console-muted">{props.label}</dt>
      <dd className="flex min-w-0 justify-end">{props.children}</dd>
    </div>
  );
}

function UnknownValue({ text }: { readonly text: string }): React.ReactElement {
  return <span className="text-agent-console-foreground">{text}</span>;
}

/** The last folder of the workspace path, which names it where the run branch does not. */
function workspaceFolder(view: AgentSessionView): string | null {
  const directory = view.workspace?.directory;
  if (!directory) return null;
  return directory.split("/").filter(Boolean).at(-1) ?? null;
}

/**
 * Model, reasoning, access and branch of a Claude Code session as the shared badges.
 * @remarks
 * The model and the reasoning are the structured values of the session view:
 * confirmed ones as confirmed, requested ones as requested. A reasoning level
 * nobody named stays "default of the model" and never reads as `none` or a
 * confirmed `medium`.
 */
export function ClaudeSessionFacts({
  step,
  view,
}: {
  readonly step: AgentPlanStepResult;
  readonly view: AgentSessionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = "plans.console.terminal.sidebar";
  const unknown = t(`${key}.unknown`);
  const access = step.session?.requested.options?.access;
  const { modelIdentity, reasoning, runBranch } = view;
  return (
    <>
      <BadgeFact label={t(`${key}.model`)}>
        {modelIdentity ? (
          <ClaudeModelBadge
            name={modelIdentity.name}
            status={modelIdentity.status}
          />
        ) : (
          <UnknownValue text={unknown} />
        )}
      </BadgeFact>
      <BadgeFact label={t(`${key}.reasoning`)}>
        {reasoning?.value && reasoning.status !== "unknown" ? (
          <ReasoningBadge
            level={reasoning.value}
            status={reasoning.status}
            isOffered={reasoning.isOffered}
          />
        ) : (
          <UnknownValue text={t("agentBadges.reasoning.default")} />
        )}
      </BadgeFact>
      <BadgeFact label={t(`${key}.access`)}>
        {access ? (
          <AccessBadge access={access} />
        ) : (
          <UnknownValue text={unknown} />
        )}
      </BadgeFact>
      <BadgeFact label={t(`${key}.branch`)} isTall>
        {runBranch ? (
          <RunBranchBadge
            branch={runBranch}
            workspaceName={workspaceFolder(view)}
          />
        ) : (
          <UnknownValue text={unknown} />
        )}
      </BadgeFact>
    </>
  );
}
