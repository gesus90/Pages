import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { PLAN_LOOP_NAME_LENGTH } from "@/definition/AgentPlanLoop";

import { LoopConditionSection } from "./plan-loop-panel/loop-condition-section";
import { LoopCountSection } from "./plan-loop-panel/loop-count-section";
import { PanelField, PanelNote, PanelSwitch } from "./plan-panel-controls";
import { LoopRunSection } from "./plan-loop-panel/loop-run-section";
import { planLoopRunOf } from "./plan-loop-summary";
import { PlanFloatingPanel } from "./plan-floating-panel";
import { planNodeLabel } from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanLoopPanelProps {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly run: AgentPlanRun | null;
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

function NameField(props: PlanLoopPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(props.loop.name);
  const isValid =
    text.trim().length > 0 && text.length <= PLAN_LOOP_NAME_LENGTH;
  function change(next: string): void {
    setText(next);
    if (next.trim().length > 0 && next.length <= PLAN_LOOP_NAME_LENGTH)
      props.graph.replaceNode({ ...props.loop, name: next });
  }
  return (
    <PanelField id={id} label={t("plans.loops.name")}>
      <Input
        id={id}
        size="sm"
        value={text}
        maxLength={PLAN_LOOP_NAME_LENGTH}
        disabled={props.isDisabled}
        aria-invalid={!isValid}
        onChange={(event) => change(event.target.value)}
        className="h-8 bg-muted/50"
      />
    </PanelField>
  );
}

function SessionSection(props: PlanLoopPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  return (
    <div className="flex flex-col gap-3">
      <PanelSwitch
        label={t("plans.loops.session.title")}
        info={{
          label: t("plans.loops.session.infoLabel"),
          text: t("plans.loops.session.info"),
        }}
        isChecked={loop.sessionPolicy === "reuse"}
        isDisabled={props.isDisabled}
        onChange={(isChecked) =>
          props.graph.replaceNode({
            ...loop,
            sessionPolicy: isChecked ? "reuse" : "fresh",
          })
        }
      />
      <PanelNote>
        {t(`plans.loops.session.${loop.sessionPolicy}Note`)}
      </PanelNote>
    </div>
  );
}

/**
 * The floating settings panel of one loop: name, count, mode, end condition and sessions.
 *
 * @remarks
 * It belongs to the selected loop and starts nothing. Changes go into the
 * plan draft at once and are stored only when the plan is saved. While a run
 * exists, the panel also lists the iterations, their results and the
 * sessions of the loop.
 */
export function PlanLoopPanel(props: PlanLoopPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  const record = planLoopRunOf(props.run, loop.id);
  const names = new Map(
    loop.steps.map((step) => [step.id, planNodeLabel(step, props.sources)]),
  );
  const sections = {
    ...props,
    onChange: (next: AgentPlanLoop): void => props.graph.replaceNode(next),
  };
  return (
    <PlanFloatingPanel
      type="loop"
      label={t("plans.loops.panel.label", { name: loop.name })}
      kicker={t("plans.loops.panel.kicker")}
      title={loop.name}
      closeLabel={t("plans.loops.panel.close")}
      closeButton={t("plans.loops.panel.closeButton")}
      hint={t("plans.loops.panel.draftHint")}
      onClose={props.onClose}
    >
      <NameField {...props} />
      <LoopCountSection {...sections} />
      <hr className="border-border" />
      <LoopConditionSection {...sections} />
      <hr className="border-border" />
      <SessionSection {...props} />
      {record ? (
        <>
          <hr className="border-border" />
          <LoopRunSection record={record} names={names} />
        </>
      ) : null}
    </PlanFloatingPanel>
  );
}
