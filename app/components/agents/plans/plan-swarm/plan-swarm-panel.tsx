import { useTranslation } from "react-i18next";

import { PlanFloatingPanel } from "../plan-floating-panel";
import { PlanSwarmExecutionSection } from "./plan-swarm-execution";
import { PlanSwarmMemorySection } from "./plan-swarm-memory-settings";
import { PlanSwarmRunTabs } from "./plan-swarm-memory-tabs";
import {
  PlanSwarmHeading,
  PlanSwarmMainSection,
  PlanSwarmTaskSection,
  PlanSwarmWorkersSection,
} from "./plan-swarm-sections";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type { PlanGraphActions } from "../use-plan-graph";

/** The lanes of the swarm in the shown run; placeholders while its first state loads. */
function PlanSwarmRunSection(props: {
  readonly swarm: AgentPlanSwarm;
  readonly run: AgentPlanRun;
}): React.ReactElement {
  const { t } = useTranslation();
  const step = props.run.steps.find((entry) => entry.id === props.swarm.id);
  return (
    <section className="flex flex-col gap-2" data-plan-swarm-section="run">
      <PlanSwarmHeading>{t("plans.swarm.sections.run")}</PlanSwarmHeading>
      <PlanSwarmRunTabs
        runId={props.run.id}
        stepId={props.swarm.id}
        run={step?.swarm}
        workerCount={props.swarm.workers.count}
        error={step?.status === "failed" ? step.error : null}
      />
    </section>
  );
}

/**
 * The floating settings panel of a swarm.
 * @remarks
 * Its sections follow the order Aufgabe → Hauptmodell → Helfer →
 * Ausführung → Gedächtnis. Changes go into the plan draft at once and are stored when the
 * plan is saved; the panel starts nothing.
 */
export function PlanSwarmPanel(props: {
  readonly swarm: AgentPlanSwarm;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: Pick<PlanGraphActions, "replaceNode">;
  readonly run: AgentPlanRun | null;
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const name = props.swarm.name ?? t("plans.nodeType.swarm");
  const sections = {
    swarm: props.swarm,
    draft: props.draft,
    sources: props.sources,
    isDisabled: props.isDisabled,
    onChange: (next: AgentPlanSwarm): void => props.graph.replaceNode(next),
  };
  return (
    <PlanFloatingPanel
      type="swarm"
      label={t("plans.swarm.panel.label", { name })}
      kicker={t("plans.swarm.panel.kicker")}
      title={name}
      closeLabel={t("plans.swarm.panel.close")}
      closeButton={t("plans.swarm.panel.closeButton")}
      hint={t("plans.swarm.panel.draftHint")}
      onClose={props.onClose}
    >
      <PlanSwarmTaskSection {...sections} />
      <hr className="border-border" />
      <PlanSwarmMainSection {...sections} />
      <hr className="border-border" />
      <PlanSwarmWorkersSection {...sections} />
      <hr className="border-border" />
      <PlanSwarmExecutionSection {...sections} />
      <hr className="border-border" />
      <PlanSwarmMemorySection {...sections} />
      {props.run ? (
        <>
          <hr className="border-border" />
          <PlanSwarmRunSection swarm={props.swarm} run={props.run} />
        </>
      ) : null}
    </PlanFloatingPanel>
  );
}
