import { useTranslation } from "react-i18next";

import { isAgentParameterName } from "@/definition/AgentParameters";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import { planTargetIssues } from "@/definition/AgentPlanTarget";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { planAgentName } from "./plan-layout";

import type { TFunction } from "i18next";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { usePlanEditor } from "./use-plan-editor";

/** One finding of the expanded panel: what it concerns and its concrete cause. */
export interface PlanPanelIssue {
  /** The affected node or area; findings with the same key share a row. */
  readonly key: string;
  readonly title: string;
  readonly cause: string;
  /** Remote parameter failures keep the whole actionable reason readable on narrow screens. */
  readonly shouldWrap?: boolean;
}

/** Which part of the plan a single refusal code concerns; anything else concerns the plan. */
const CODE_TITLES: readonly (readonly [RegExp, string])[] = [
  [/^plan_remote_|^plan_runner_/, "target"],
  [/^workspace_|^plan_workspace_|^plan_directory_|^plan_context_/, "workspace"],
  [
    /^model_|^provider_|^configuration_|^plan_model_|^plan_reasoning_|acp_adapter/,
    "model",
  ],
  [/^plan_script_/, "script"],
  [/^plan_run_|^plan_continuation_|^plan_closeout_|^plan_pause_/, "run"],
];

function codeTitle(
  code: string,
  control: AgentPlanControl | undefined,
  translate: TFunction,
): string {
  if (control?.status === "failed" && control.canPlay)
    return translate("plans.panel.issueTitle.lastRun");
  const area =
    CODE_TITLES.find(([pattern]) => pattern.test(code))?.[1] ?? "plan";
  return translate(`plans.panel.issueTitle.${area}`);
}

/** Names the node and input of a finding by their names, never by an identifier. */
function issueSubject(
  issue: AgentPlanIssue,
  editor: ReturnType<typeof usePlanEditor>,
  translate: TFunction,
): string {
  // Frames are replaced by their members when groups are expanded; loops keep theirs.
  const node = [
    ...editor.draft.nodes,
    ...expandPlanGroups(editor.draft).nodes,
    ...editor.draft.nodes.flatMap((entry) =>
      entry.type === "loop" ? entry.steps : [],
    ),
  ].find((entry) => entry.id === issue.nodeId);
  let name = translate("plans.panel.issueTitle.plan");
  if (node?.type === "agent")
    name =
      planAgentName(node, editor.sources) || translate("plans.missingAgent");
  else if (node?.type === "task") {
    const task = editor.sources.tasks.find((entry) => entry.id === node.taskId);
    name = task ? task.key : translate("plans.ticketUnavailable");
  } else if (node?.type === "start" || node?.type === "end")
    name = translate(`plans.nodeType.${node.type}`);
  else if (node) name = node.name;
  return name;
}

function issuePort(issue: AgentPlanIssue): string {
  return issue.port && isAgentParameterName(issue.port) ? issue.port : "";
}

/** A missing required value names its input in the cause; every other finding names it in the title. */
function issueTitle(
  issue: AgentPlanIssue,
  editor: ReturnType<typeof usePlanEditor>,
  translate: TFunction,
): string {
  const port = issuePort(issue);
  const name = issueSubject(issue, editor, translate);
  return port && issue.reason !== "required" ? `${name} · ${port}` : name;
}

function issueCause(issue: AgentPlanIssue, translate: TFunction): string {
  const port = issuePort(issue);
  const keys = [`plans.validation.${issue.reason}`];
  // A node-bound finding gets the sentence about that node, not the plan-wide one.
  if (issue.nodeId !== null)
    keys.unshift(`plans.panel.issueCause.${issue.reason}`);
  if (issue.nodeId !== null && port && issue.reason === "required")
    keys.unshift("plans.panel.issueCause.requiredPort");
  return translate(keys, { port });
}

/**
 * The findings that keep the plan from starting or continuing, one entry each.
 *
 * @remarks
 * Graph findings name their node, and so do nodes their remote target
 * cannot run; a refusal of the server's start check names the area it
 * concerns. The summary code of graph findings is not
 * repeated next to them. Nothing here contains a stack trace or a secret:
 * every text is a translation of a stable code.
 */
export function planPanelIssues(input: {
  readonly control: AgentPlanControl | undefined;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly code: string | null;
  readonly translate: TFunction;
}): readonly PlanPanelIssue[] {
  const { control, editor, translate } = input;
  const result = editor.command.data;
  const graph =
    (result?.ok === false ? result.issues : undefined) ?? control?.issues ?? [];
  const entries: PlanPanelIssue[] = graph.map((issue) => ({
    key: `node-${issue.nodeId ?? ""}-${issue.port ?? ""}`,
    title: issueTitle(issue, editor, translate),
    cause: issueCause(issue, translate),
    shouldWrap: issue.port !== null && issue.reason.startsWith("remote"),
  }));
  for (const issue of planTargetIssues(
    withPortlessPlanGroups(editor.draft),
    editor.sources.remoteStatus,
  ))
    entries.push({
      key: `node-${issue.nodeId}-${issue.port ?? ""}`,
      title: issueTitle(
        { nodeId: issue.nodeId, port: issue.port ?? null, reason: "agent" },
        editor,
        translate,
      ),
      cause: translate(`plans.panel.issueCause.${issue.problem}`),
      shouldWrap: issue.port !== undefined,
    });
  if (input.code && !(input.code === "plan_invalid" && graph.length > 0))
    entries.push({
      key: `code-${input.code}`,
      title: codeTitle(input.code, control, translate),
      cause: translate(`settings.agents.error.${input.code}`, {
        defaultValue: translate("plans.panel.error"),
      }),
    });
  return bySubject(entries);
}

/** One row per affected step or area; its causes follow each other. */
function bySubject(
  entries: readonly PlanPanelIssue[],
): readonly PlanPanelIssue[] {
  const rows = new Map<string, PlanPanelIssue>();
  for (const entry of entries) {
    const row = rows.get(entry.key);
    rows.set(
      entry.key,
      row && !row.cause.includes(entry.cause)
        ? {
            ...row,
            cause: `${row.cause} ${entry.cause}`,
            shouldWrap: row.shouldWrap === true || entry.shouldWrap === true,
          }
        : (row ?? entry),
    );
  }
  return [...rows.values()];
}

/**
 * The expanded list of findings: an orange mark, what is affected, and why.
 *
 * @remarks
 * Remote parameter causes wrap so the complete refusal remains readable on
 * small screens. Other findings keep their established horizontal scroll.
 */
export function PlanPanelIssueList({
  issues,
}: {
  readonly issues: readonly PlanPanelIssue[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul aria-label={t("plans.panel.issuesLabel")} className="grid gap-2">
      {issues.map((issue) => (
        <li
          key={issue.key}
          className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/70 py-2.5 pr-1 pl-4"
        >
          <span
            aria-hidden="true"
            className="shrink-0 text-sm leading-none font-bold text-primary"
          >
            !
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold wrap-anywhere text-foreground">
              {issue.title}
            </p>
            {issue.shouldWrap ? (
              <p className="pages-selectable mt-0.5 pr-3 text-xs leading-4.5 wrap-anywhere text-muted-foreground">
                {issue.cause}
              </p>
            ) : (
              <ScrollViewport
                as="span"
                axis="horizontal"
                title={issue.cause}
                containerClassName="mt-0.5"
                className="pages-selectable block pr-3 text-xs whitespace-nowrap text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {issue.cause}
              </ScrollViewport>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
