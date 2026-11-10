import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { createRandomUuid } from "@/app/lib/random-uuid";
import {
  PLAN_DECISION_CASES,
  PLAN_DECISION_CASE_NAME_LENGTH,
} from "@/definition/AgentPlanDecision";

import { planDecisionCaseNameProblem } from "./plan-decision-form";

import type { AgentPlanDecisionCase } from "@/definition/AgentPlanDecision";

/** The question before a connected value goes, with its two answers. */
function RemovalQuestion(props: {
  readonly name: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role="alertdialog"
      aria-label={t("plans.decision.dialog.removeTitle", { name: props.name })}
      className="flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning-subtle px-2 py-1.5 text-xs"
    >
      <span className="min-w-0 flex-1">
        {t("plans.decision.dialog.removeConnected", { name: props.name })}
      </span>
      <Button size="xs" variant="outline" onClick={props.onCancel}>
        {t("settings.agents.cancel")}
      </Button>
      <Button size="xs" variant="destructive" onClick={props.onConfirm}>
        {t("plans.decision.dialog.removeConfirm")}
      </Button>
    </div>
  );
}

/**
 * The value list of a classification, kept in the decision itself.
 *
 * @remarks
 * Each value keeps a stable id, so renaming keeps the connection of its
 * output. A value whose output is connected goes only after the person
 * confirms; Apply then removes that connection with it.
 */
export function PlanDecisionCases(props: {
  readonly cases: readonly AgentPlanDecisionCase[];
  readonly isDisabled: boolean;
  readonly isConnected: (caseId: string) => boolean;
  readonly onChange: (cases: readonly AgentPlanDecisionCase[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<string | null>(null);
  const { cases } = props;
  const problem = planDecisionCaseNameProblem(cases);
  function rename(id: string, name: string): void {
    props.onChange(
      cases.map((entry) => (entry.id === id ? { ...entry, name } : entry)),
    );
  }
  function remove(id: string): void {
    setAsking(null);
    props.onChange(cases.filter((entry) => entry.id !== id));
  }
  return (
    <fieldset className="space-y-1.5 text-sm" data-plan-decision-cases>
      <legend className="mb-1">{t("plans.decision.dialog.cases")}</legend>
      <p className="text-xs text-muted-foreground">
        {t("plans.decision.dialog.casesHint", {
          minimum: PLAN_DECISION_CASES.minimum,
          maximum: PLAN_DECISION_CASES.maximum,
        })}
      </p>
      {cases.map((entry, index) => (
        <div key={entry.id} className="space-y-1">
          <div className="flex items-center gap-2">
            <Input
              value={entry.name}
              maxLength={PLAN_DECISION_CASE_NAME_LENGTH}
              aria-label={t("plans.decision.dialog.caseName", {
                number: index + 1,
              })}
              disabled={props.isDisabled}
              onChange={(event) => rename(entry.id, event.target.value)}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("plans.decision.dialog.removeCase", {
                name: entry.name || index + 1,
              })}
              disabled={props.isDisabled}
              onClick={() =>
                props.isConnected(entry.id)
                  ? setAsking(entry.id)
                  : remove(entry.id)
              }
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {asking === entry.id ? (
            <RemovalQuestion
              name={entry.name}
              onCancel={() => setAsking(null)}
              onConfirm={() => remove(entry.id)}
            />
          ) : null}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={
          props.isDisabled || cases.length >= PLAN_DECISION_CASES.maximum
        }
        onClick={() =>
          props.onChange([...cases, { id: createRandomUuid(), name: "" }])
        }
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("plans.decision.dialog.addCase")}
      </Button>
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`plans.decision.dialog.caseProblem.${problem}`, {
            maximum: PLAN_DECISION_CASE_NAME_LENGTH,
          })}
        </p>
      ) : null}
      {cases.length < PLAN_DECISION_CASES.minimum ? (
        <p className="text-xs text-warning">
          {t("plans.decision.dialog.casesTooFew", {
            minimum: PLAN_DECISION_CASES.minimum,
          })}
        </p>
      ) : null}
    </fieldset>
  );
}
