import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT } from "@/definition/AgentPlanBranching";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";

import { planRefusalKey } from "./plan-connection-refusal";
import { PlanDecisionModelFields } from "./plan-decision-dialog/plan-decision-model-fields";
import {
  appliedPlanDecisionForm,
  isPlanDecisionCaseConnected,
  isPlanDecisionClassification,
  planDecisionCaseNameProblem,
  planDecisionFormOf,
  planDecisionInputChoices,
  planDecisionModels,
} from "./plan-decision-dialog/plan-decision-form";
import { planAgentName, planNodeAccent } from "./plan-layout";
import { PlanNodeIcon } from "./plan-node-icon";

import type { TFunction } from "i18next";
import type {
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanDecisionMode } from "@/definition/AgentPlanDecision";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { PlanDecisionForm } from "./plan-decision-dialog/plan-decision-form";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanDecisionDialogProps {
  readonly decision: AgentPlanDecision;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

/**
 * The agents of the plan a boolean decision can read, named for the choice.
 *
 * @remarks
 * Two agents with the same name get a number, so that the choice is never
 * ambiguous; the value is always the identifier of the agent.
 */
export function planConditionChoices(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  translate: TFunction,
): readonly { readonly value: string; readonly label: string }[] {
  const agents = draft.nodes.flatMap((node) =>
    node.type === "agent"
      ? [
          {
            value: node.id,
            name:
              planAgentName(node, sources) || translate("plans.missingAgent"),
          },
        ]
      : [],
  );
  const seen = new Map<string, number>();
  return [
    { value: "", label: translate("plans.decision.dialog.none") },
    ...agents.map((agent) => {
      const count = (seen.get(agent.name) ?? 0) + 1;
      seen.set(agent.name, count);
      const isRepeated =
        agents.filter((entry) => entry.name === agent.name).length > 1;
      return {
        value: agent.value,
        label: isRepeated ? `${agent.name} · ${count}` : agent.name,
      };
    }),
  ];
}

function issueKey(issue: AgentPlanIssue): string {
  return `${issue.nodeId ?? ""}|${issue.port ?? ""}|${issue.reason}`;
}

/** What the new data input adds to the findings of the draft, as a line to the input would be refused. */
function inputRefusal(
  draft: AgentPlanInput,
  next: AgentPlanInput,
  input: { readonly decisionId: string; readonly sources: AgentPlanSources },
): AgentPlanIssue | null {
  const known = new Set(
    planConnectionIssues(draft, input.sources.agents).map(issueKey),
  );
  return (
    planConnectionIssues(next, input.sources.agents).find(
      (issue) =>
        !known.has(issueKey(issue)) &&
        (issue.reason === "cycle" ||
          (issue.nodeId === input.decisionId &&
            issue.port === PLAN_PORT.conditionIn)),
    ) ?? null
  );
}

/** The choice of what the decision reads, and the reason when a choice is refused. */
function DecisionInputField(props: {
  readonly form: PlanDecisionForm;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly isDisabled: boolean;
  readonly refusal: AgentPlanIssue | null;
  readonly onChange: (value: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const options = planDecisionInputChoices(
    props.draft,
    props.sources,
    props.form.mode,
    t,
  );
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={id}>
        {t(
          props.form.mode === "model"
            ? "plans.decision.dialog.content"
            : "plans.decision.dialog.condition",
        )}
      </label>
      <Select
        id={id}
        size="default"
        className="w-full"
        value={
          options.some((option) => option.value === props.form.input)
            ? props.form.input
            : ""
        }
        options={options}
        disabled={props.isDisabled}
        onValueChange={props.onChange}
      />
      {props.refusal ? (
        <p role="alert" className="text-xs text-destructive">
          {t(planRefusalKey(props.refusal))}
        </p>
      ) : null}
    </div>
  );
}

/** The dialog's own state: the form and why the last Apply was refused. */
function useDecisionForm(props: PlanDecisionDialogProps): {
  readonly form: PlanDecisionForm;
  readonly refusal: AgentPlanIssue | null;
  readonly change: (form: PlanDecisionForm) => void;
  readonly apply: () => void;
} {
  const models = planDecisionModels(props.sources);
  const [form, setForm] = useState(() =>
    planDecisionFormOf(props.draft, props.decision, models),
  );
  const [refusal, setRefusal] = useState<AgentPlanIssue | null>(null);
  function apply(): void {
    if (props.isDisabled) return;
    if (
      isPlanDecisionClassification(form) &&
      planDecisionCaseNameProblem(form.cases) !== null
    )
      return;
    const next = appliedPlanDecisionForm(props.draft, props.decision, {
      form,
      models,
    });
    const issue = inputRefusal(props.draft, next, {
      decisionId: props.decision.id,
      sources: props.sources,
    });
    if (issue) {
      setRefusal(issue);
      return;
    }
    props.graph.edit((current) =>
      appliedPlanDecisionForm(current, props.decision, { form, models }),
    );
    props.onClose();
  }
  return {
    form,
    refusal,
    change: (next) => {
      // Another mode reads another kind of source, so the chosen one no longer fits.
      const input = next.mode === form.mode ? next.input : "";
      setForm({ ...next, input });
      setRefusal(null);
    },
    apply,
  };
}

/**
 * The dialog of a decision: its name, its mode, its data input and, for a
 * model decision, its question, model and answers.
 *
 * @remarks
 * Edits stay private until Apply. The data input is the same connection a
 * line into the decision draws; the dialog refuses what such a line would
 * refuse, with the reason. The decision decides anew at every activation,
 * and a missing or invalid value never activates an output.
 */
export function PlanDecisionDialog(
  props: PlanDecisionDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { decision, draft } = props;
  const nameId = useId();
  const { form, refusal, change, apply } = useDecisionForm(props);
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent
        overlayClassName="bg-transparent"
        size="md"
        className="max-h-[90vh] space-y-4 overflow-y-auto"
        data-plan-dialog="decision"
        onCloseAutoFocus={(event) => {
          // The caller returns the focus to the card of the decision.
          event.preventDefault();
          props.onClose();
        }}
      >
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <PlanNodeIcon
            type="decision"
            className={cn("size-5 shrink-0", planNodeAccent("decision"))}
          />
          {t("plans.decision.dialog.title")}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t(
            form.mode === "model"
              ? "plans.decision.dialog.hintModel"
              : "plans.decision.dialog.hint",
          )}
        </DialogDescription>
        <label htmlFor={nameId} className="block space-y-1 text-sm">
          <span>{t("plans.decision.dialog.name")}</span>
          <Input
            id={nameId}
            value={form.name}
            maxLength={120}
            placeholder={t("plans.nodeType.decision")}
            disabled={props.isDisabled}
            onChange={(event) => change({ ...form, name: event.target.value })}
          />
        </label>
        <div className="space-y-1 text-sm">
          <span className="block">{t("plans.decision.dialog.mode")}</span>
          <SegmentedControl<AgentPlanDecisionMode>
            ariaLabel={t("plans.decision.dialog.mode")}
            value={form.mode}
            options={[
              {
                value: "boolean",
                label: t("plans.decision.dialog.modeBoolean"),
              },
              { value: "model", label: t("plans.decision.dialog.modeModel") },
            ]}
            onValueChange={(mode) => {
              if (!props.isDisabled) change({ ...form, mode });
            }}
          />
        </div>
        <DecisionInputField
          form={form}
          draft={draft}
          sources={props.sources}
          isDisabled={props.isDisabled}
          refusal={refusal}
          onChange={(input) => change({ ...form, input })}
        />
        {form.mode === "model" ? (
          <PlanDecisionModelFields
            form={form}
            models={planDecisionModels(props.sources)}
            isDisabled={props.isDisabled}
            isCaseConnected={(caseId) =>
              isPlanDecisionCaseConnected(draft, decision.id, caseId)
            }
            onChange={change}
          />
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            {t("settings.agents.cancel")}
          </Button>
          {props.isDisabled ? null : (
            <Button size="sm" onClick={apply}>
              {t("plans.closeNode")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
