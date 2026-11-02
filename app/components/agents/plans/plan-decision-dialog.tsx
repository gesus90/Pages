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
import { cn } from "@/app/lib/cn";
import { planConditionSource } from "@/definition/AgentPlanBranching";

import { planRefusalKey } from "./plan-connection-refusal";
import { planAgentName, planNodeAccent } from "./plan-layout";
import { PlanNodeIcon } from "./plan-node-icon";
import { planConditionRefusal } from "./use-plan-connections";

import type { TFunction } from "i18next";
import type {
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
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
 * The agents of the plan a decision can read, named for the choice.
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

/** The decision with the name the person typed; an empty name returns it to the type name. */
function namedDecision(
  decision: AgentPlanDecision,
  name: string,
): AgentPlanDecision {
  const trimmed = name.trim();
  const { id, type, x, y } = decision;
  return trimmed ? { id, type, x, y, name: trimmed } : { id, type, x, y };
}

/** The choice of the agent a decision reads, and the reason when a choice is refused. */
function DecisionConditionField(props: {
  readonly id: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly isDisabled: boolean;
  readonly refusal: AgentPlanIssue | null;
  readonly onChange: (value: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={props.id}>{t("plans.decision.dialog.condition")}</label>
      <Select
        id={props.id}
        size="default"
        className="w-full"
        value={props.value}
        options={props.options}
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

/**
 * The compact dialog of a decision: its optional name and the agent whose
 * boolean result it reads.
 *
 * @remarks
 * Edits stay private until Apply. The condition is the same connection a
 * line from the agent's boolean result to the decision draws; the dialog
 * only offers it as a list, and refuses what such a line would refuse, with
 * the reason in the dialog. The decision is evaluated anew at every pass,
 * a missing or invalid value never counts as false, and the decision is no
 * language-model agent.
 */
export function PlanDecisionDialog(
  props: PlanDecisionDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { decision, draft } = props;
  const nameId = useId();
  const conditionId = useId();
  const current = planConditionSource(draft, decision.id) ?? "";
  const [name, setName] = useState(decision.name ?? "");
  const [condition, setCondition] = useState(current);
  const [refusal, setRefusal] = useState<AgentPlanIssue | null>(null);
  function choose(next: string): void {
    setCondition(next);
    setRefusal(null);
  }
  function apply(): void {
    if (props.isDisabled) return;
    const agentId = condition === "" ? null : condition;
    if (condition !== current) {
      const issue = planConditionRefusal(
        draft,
        props.sources,
        decision.id,
        agentId,
      );
      if (issue) {
        setRefusal(issue);
        return;
      }
    }
    props.graph.replaceNode(namedDecision(decision, name));
    if (condition !== current)
      props.graph.setDecisionCondition(decision.id, agentId);
    props.onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent
        overlayClassName="bg-transparent"
        size="sm"
        className="space-y-4"
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
          {t("plans.decision.dialog.hint")}
        </DialogDescription>
        <label htmlFor={nameId} className="block space-y-1 text-sm">
          <span>{t("plans.decision.dialog.name")}</span>
          <Input
            id={nameId}
            value={name}
            maxLength={200}
            placeholder={t("plans.nodeType.decision")}
            disabled={props.isDisabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <DecisionConditionField
          id={conditionId}
          value={condition}
          options={planConditionChoices(draft, props.sources, t)}
          isDisabled={props.isDisabled}
          refusal={refusal}
          onChange={choose}
        />
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
